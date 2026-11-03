/**
 * An exploration generates stories instead of telling one: random paths of messages, command
 * answers and restarts through a Program, each checked with every strict rule a story runs except
 * command assertions. A failing path shrinks to a short story, its counterexample.
 */
import {
	Arbitrary,
	Array as Arr,
	Data,
	Effect,
	Match,
	Option,
	Order,
	Predicate,
	Ref,
	Schema
} from 'effect';
import type { Problem } from './internal/check.ts';
import { machine } from './internal/machine.ts';
import type { State } from './internal/machine.ts';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import type { Program, Tagged } from './Program.ts';
import * as Story from './Story.ts';

export interface Options<Model, Message, Command> {
	/** The models a path starts from. */
	readonly given: Arbitrary.Arbitrary<Model>;
	/** The messages a path sends; by default any the Message Schema allows. */
	readonly send?: Arbitrary.Arbitrary<Message>;
	/** The messages a pending command completes with; a command with none stays pending. */
	readonly replies?: (command: Command) => ReadonlyArray<Message>;
	/** The messages a pending command streams while it stays pending. */
	readonly emits?: (command: Command) => ReadonlyArray<Message>;
	/** Whether paths restart; by default they do. */
	readonly restarts?: boolean;
	/** How many paths to check; 100 by default. */
	readonly runs?: number;
	/** The most actions a path takes; 30 by default. */
	readonly steps?: number;
	/** The seed paths come from; the title by default, so every run checks the same paths. */
	readonly seed?: string | number;
}

export class Exploration<
	Model,
	Message extends Tagged,
	Command extends Tagged
> extends Data.TaggedClass('Exploration')<{
	readonly title: string;
	readonly program: Program<Model, Message, Command>;
	readonly given: Arbitrary.Arbitrary<Model>;
	readonly send: Arbitrary.Arbitrary<Message>;
	readonly replies: (command: Command) => ReadonlyArray<Message>;
	readonly emits: (command: Command) => ReadonlyArray<Message>;
	readonly restarts: boolean;
	readonly runs: number;
	readonly steps: number;
	readonly seed: string | number;
}> {
	[TypeId](): Told {
		return { lines: lines(this), run: check(this) };
	}
}

const nothing = () => [];

export const make = <Model, Message extends Tagged, Command extends Tagged>(
	title: string,
	program: Program<Model, Message, Command>,
	options: Options<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>
): Exploration<Model, Message, Command> =>
	new Exploration({
		title,
		program,
		replies: nothing,
		emits: nothing,
		restarts: true,
		runs: 100,
		steps: 30,
		seed: title,
		...options,
		// Derived only when needed, since not every Message Schema has an Arbitrary.
		send: options.send ?? Arbitrary.schema(program.Message)
	});

const summary = <Model, Message extends Tagged, Command extends Tagged>(
	exploration: Exploration<Model, Message, Command>
) =>
	`explore ${exploration.runs} runs of up to ${exploration.steps} steps, seed ${JSON.stringify(exploration.seed)}${exploration.restarts ? ', with restarts' : ''}`;

/** Renders an exploration as its one line; a failure's counterexample is a story's lines. */
export const lines = <Model, Message extends Tagged, Command extends Tagged>(
	exploration: Exploration<Model, Message, Command>
): ReadonlyArray<string> => [summary(exploration)];

type Action<Message> = Data.TaggedEnum<{
	Send: { readonly message: Message };
	/** Answers the pending command at `pick`, sorted by key, with its answer at `choice`. */
	Reply: { readonly pick: number; readonly choice: number };
	// oxlint-disable-next-line typescript/no-empty-object-type -- TaggedEnum spells a case without fields as {}
	Restart: {};
}>;

interface ActionDefinition extends Data.TaggedEnum.WithGenerics<1> {
	readonly taggedEnum: Action<this['A']>;
}

const Action = Data.taggedEnum<ActionDefinition>();

interface Path<Model, Message> {
	readonly start: Model;
	readonly actions: ReadonlyArray<Action<Message>>;
}

const index = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })));

const paths = <Model, Message extends Tagged, Command extends Tagged>(
	exploration: Exploration<Model, Message, Command>
): Arbitrary.Arbitrary<Path<Model, Message>> => {
	const kinds = Schema.Literals(
		exploration.restarts ? ['Send', 'Reply', 'Restart'] : ['Send', 'Reply']
	);
	const action = Arbitrary.flatMap(
		Arbitrary.schema(kinds),
		(kind): Arbitrary.Arbitrary<Action<Message>> =>
			({
				Send: Arbitrary.map(exploration.send, (message) => Action.Send({ message })),
				Reply: Arbitrary.map(Arbitrary.all({ pick: index, choice: index }), Action.Reply),
				Restart: Arbitrary.Constant(Action.Restart())
			})[kind]
	);
	return Arbitrary.all({ start: exploration.given, actions: Arbitrary.array(action) });
};

/** Where a path broke a rule, before the check knows the replay that reproduces it. */
class Broken extends Data.Error<{
	readonly step: number;
	readonly problem: Problem;
	readonly counterexample: ReadonlyArray<string>;
}> {}

type Move<Model, Message, Command> = readonly [
	Story.Step<Model, Message, Command>,
	Effect.Effect<State<Model, Command>, Problem>
];

const byKey = Order.mapInput(Order.String, (entry: { readonly key: string }) => entry.key);

/** Walks a path, turning each action into a story step, and gives the cases it reached. */
const walker = <Model, Message extends Tagged, Command extends Tagged>(
	exploration: Exploration<Model, Message, Command>
) => {
	const { title, program } = exploration;
	const rules = machine(program, false);

	/** Answers the pending command at `pick` with its reply or stream message at `choice`. */
	const reply = (
		state: State<Model, Command>,
		pick: number,
		choice: number
	): Option.Option<Move<Model, Message, Command>> =>
		Arr.match(Arr.sort(state.pending, byKey), {
			onEmpty: Option.none,
			onNonEmpty: (pending) =>
				Option.flatMap(Arr.get(pending, pick % pending.length), ({ command }) =>
					Arr.match(
						[
							...exploration
								.replies(command)
								.map((message): Move<Model, Message, Command> => [
									Story.resolve(command, message),
									rules.resolve(state, command, Option.some(message))
								]),
							...exploration
								.emits(command)
								.map((message): Move<Model, Message, Command> => [
									Story.emit(command, message),
									rules.emit(state, command, message)
								])
						],
						{
							onEmpty: Option.none,
							onNonEmpty: (answers) => Arr.get(answers, choice % answers.length)
						}
					)
				)
		});

	const moved = (
		step: Story.Step<Model, Message, Command>,
		effect: Effect.Effect<State<Model, Command>, Problem>
	): Option.Option<Move<Model, Message, Command>> => Option.some([step, effect]);

	const move = (
		state: State<Model, Command>,
		action: Action<Message>
	): Option.Option<Move<Model, Message, Command>> =>
		Action.$match(action, {
			Send: ({ message }) => moved(Story.send(message), rules.send(state, message)),
			Reply: ({ pick, choice }) => reply(state, pick, choice),
			Restart: () => moved(Story.restart(), rules.restart(state))
		});

	return Effect.fnUntraced(function* (path: Path<Model, Message>) {
		const told: Array<Story.Step<Model, Message, Command>> = [Story.given(path.start)];
		const broken = (problem: Problem) =>
			new Broken({
				step: told.length,
				problem,
				counterexample: Story.lines(Story.make(title, program, ...told))
			});
		let state = yield* Effect.mapError(rules.start(path.start), broken);
		for (const action of path.actions) {
			const next = move(state, action);
			if (Option.isSome(next)) {
				const [step, effect] = next.value;
				told.push(step);
				state = yield* Effect.mapError(effect, broken);
			}
		}
		return state.cases;
	});
};

/** What a passing exploration checked: its runs and every case its paths sent, produced or reached. */
export interface Explored {
	readonly runs: number;
	readonly cases: ReadonlyArray<string>;
}

/**
 * Checks `runs` generated paths. A failure carries the shrunk path as a story's lines, its
 * counterexample, with `step` numbering the line that failed, and a `replay` token that checks
 * just that path again.
 */
export const check = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged
>(
	exploration: Exploration<Model, Message, Command>,
	options?: { readonly replay?: Arbitrary.Replay }
): Effect.fn.Return<Explored, Story.StoryFailure> {
	const { title } = exploration;
	const walk = walker(exploration);
	const seen = yield* Ref.make<ReadonlyArray<string>>([]);
	const result = yield* Arbitrary.checkEffect(
		paths(exploration),
		(path) =>
			walk(path).pipe(
				Effect.flatMap((cases) => Ref.update(seen, (all) => Arr.dedupe([...all, ...cases]))),
				Effect.as(true)
			),
		{
			runs: exploration.runs,
			size: exploration.steps,
			seed: exploration.seed,
			replay: options?.replay
		}
	);
	const line = summary(exploration);
	return yield* Match.value(result).pipe(
		Match.tag('Passed', ({ runs }) =>
			Effect.map(Ref.get(seen), (cases): Explored => ({ runs, cases: cases.toSorted() }))
		),
		// Every path passes or fails, so a property error is the only way a path is falsified.
		Match.when({ failure: Predicate.isTagged('PropertyError') }, ({ failure: { error }, replay }) =>
			Effect.fail(
				new Story.StoryFailure({
					title,
					step: error.step,
					line,
					message: error.problem.message,
					expected: error.problem.expected,
					actual: error.problem.actual,
					counterexample: error.counterexample,
					replay
				})
			)
		),
		Match.orElse((unfinished) =>
			Effect.fail(
				new Story.StoryFailure({
					title,
					step: 1,
					line,
					message: String(Arbitrary.formatCheckFailure(unfinished))
				})
			)
		)
	);
});
