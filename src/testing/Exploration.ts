/**
 * An exploration generates tales instead of telling one: random paths of messages, command answers
 * and restarts through a Program, or of commands through a Decider, each checked with every strict
 * rule a story or decision runs except command assertions. A failing path shrinks to a short tale,
 * its counterexample.
 */
import {
	Arbitrary,
	Array as Arr,
	Data,
	Effect,
	Match,
	Option,
	Predicate,
	Ref,
	Schema
} from 'effect';
import type { Decider } from '../Decider.ts';
import * as Decision from './Decision.ts';
import { Broken } from './internal/check.ts';
import type { Problem } from './internal/check.ts';
import { caser, strict } from './internal/decider.ts';
import { machine } from './internal/machine.ts';
import type { State as Running } from './internal/machine.ts';
import { located, made, TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import type { Program, Tagged } from '../Program.ts';
import * as Story from './Story.ts';

interface Settings {
	/** How many paths to check; 100 by default. */
	readonly runs?: number;
	/** The most actions a path takes; 30 by default. */
	readonly steps?: number;
	/** The seed paths come from; the title by default, so every run checks the same paths. */
	readonly seed?: string | number;
}

export interface Options<Model, Message, Command> extends Settings {
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
}

export interface DecisionOptions<State, Command> extends Settings {
	/** The states a path starts from; the Decider's `initial` by default. */
	readonly given?: Arbitrary.Arbitrary<State>;
	/** The commands a path decides; by default any the Command Schema allows. */
	readonly when?: Arbitrary.Arbitrary<Command>;
}

/** One generated path, walked: the cases it touched, or where it broke a rule. */
type Walk = Effect.Effect<ReadonlyArray<string>, Broken>;

export class Exploration extends Data.TaggedClass('Exploration')<{
	readonly title: string;
	readonly subject: object;
	readonly runs: number;
	readonly steps: number;
	readonly seed: string | number;
	readonly restarts: boolean;
	readonly walks: Arbitrary.Arbitrary<Walk>;
}> {
	[TypeId](): Told {
		return { subject: this.subject, lines: lines(this), run: check(this) };
	}
}

const settled = (title: string, settings: Settings) => ({
	runs: settings.runs ?? 100,
	steps: settings.steps ?? 30,
	seed: settings.seed ?? title
});

const nothing = () => [];

/** Explores a Program: paths of sent messages, command answers and restarts from a given model. */
export const make = <Model, Message extends Tagged, Command extends Tagged>(
	title: string,
	program: Program<Model, Message, Command>,
	options: Options<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>
): Exploration => {
	const restarts = options.restarts ?? true;
	const exploration = new Exploration({
		title,
		subject: program,
		...settled(title, options),
		restarts,
		walks: Arbitrary.map(
			paths(
				options.given,
				// Derived only when needed, since not every Message Schema has an Arbitrary.
				options.send ?? Arbitrary.schema(program.Message),
				restarts
			),
			walker(title, program, options.replies ?? nothing, options.emits ?? nothing)
		)
	});
	return made(exploration, make);
};

/** Explores a Decider: paths of commands decided one after another from a given state. */
export const decisions = <State, Command, Event, Rejection>(
	title: string,
	decider: Decider<State, Command, Event, Rejection>,
	options: DecisionOptions<NoInfer<State>, NoInfer<Command>> = {}
): Exploration =>
	made(
		new Exploration({
			title,
			subject: decider,
			...settled(title, options),
			restarts: false,
			walks: Arbitrary.map(
				Arbitrary.all({
					start: options.given ?? Arbitrary.Constant(decider.initial),
					commands: Arbitrary.array(options.when ?? Arbitrary.schema(decider.Command))
				}),
				deciderWalker(title, decider)
			)
		}),
		decisions
	);

const summary = (exploration: Exploration) =>
	`explore ${exploration.runs} runs of up to ${exploration.steps} steps, seed ${JSON.stringify(exploration.seed)}${exploration.restarts ? ', with restarts' : ''}`;

/** Renders an exploration as its one line; a failure's counterexample is a tale's lines. */
export const lines = (exploration: Exploration): ReadonlyArray<string> => [summary(exploration)];

type Action<Message> = Data.TaggedEnum<{
	Send: { readonly message: Message };
	/** Answers the pending command at `pick`, in the order produced, with its answer at `choice`. */
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

const index = Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)));

const paths = <Model, Message>(
	given: Arbitrary.Arbitrary<Model>,
	send: Arbitrary.Arbitrary<Message>,
	restarts: boolean
): Arbitrary.Arbitrary<Path<Model, Message>> => {
	const kinds = Schema.Literals(restarts ? ['Send', 'Reply', 'Restart'] : ['Send', 'Reply']);
	const action = Arbitrary.flatMap(
		Arbitrary.schema(kinds),
		(kind): Arbitrary.Arbitrary<Action<Message>> =>
			({
				Send: Arbitrary.map(send, (message) => Action.Send({ message })),
				Reply: Arbitrary.map(Arbitrary.all({ pick: index, choice: index }), Action.Reply),
				Restart: Arbitrary.Constant(Action.Restart())
			})[kind]
	);
	return Arbitrary.all({ start: given, actions: Arbitrary.array(action) });
};

type Move<Model, Message, Command> = readonly [
	Story.Step<Model, Message, Command>,
	Effect.Effect<Running<Model, Command>, Problem>
];

/** Walks a Program's path, turning each action into a story step, and gives the cases it reached. */
const walker = <Model, Message extends Tagged, Command extends Tagged>(
	title: string,
	program: Program<Model, Message, Command>,
	replies: (command: Command) => ReadonlyArray<Message>,
	emits: (command: Command) => ReadonlyArray<Message>
) => {
	const rules = machine(program, false);
	const story = Story.of(program);

	/** Answers the pending command at `pick` with its reply or stream message at `choice`. */
	const reply = (
		state: Running<Model, Command>,
		pick: number,
		choice: number
	): Option.Option<Move<Model, Message, Command>> =>
		Arr.match(state.pending, {
			onEmpty: Option.none,
			onNonEmpty: (pending) =>
				Option.flatMap(Arr.get(pending, pick % pending.length), ({ command }) =>
					Arr.match(
						[
							...replies(command).map((message): Move<Model, Message, Command> => [
								story.resolve(command, message),
								rules.resolve(state, command, Option.some(message))
							]),
							...emits(command).map((message): Move<Model, Message, Command> => [
								story.emit(command, message),
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
		effect: Effect.Effect<Running<Model, Command>, Problem>
	): Option.Option<Move<Model, Message, Command>> => Option.some([step, effect]);

	const move = (
		state: Running<Model, Command>,
		action: Action<Message>
	): Option.Option<Move<Model, Message, Command>> =>
		Action.$match(action, {
			Send: ({ message }) => moved(story.send(message), rules.send(state, message)),
			Reply: ({ pick, choice }) => reply(state, pick, choice),
			Restart: () => moved(story.restart(), rules.restart(state))
		});

	return Effect.fnUntraced(function* (
		path: Path<Model, Message>
	): Effect.fn.Return<ReadonlyArray<string>, Broken> {
		const told: Array<Story.Step<Model, Message, Command>> = [story.given(path.start)];
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

/** Walks a Decider's path, turning each command into a `when`, and gives the cases it touched. */
const deciderWalker = <State, Command, Event, Rejection>(
	title: string,
	decider: Decider<State, Command, Event, Rejection>
) => {
	const rules = strict(decider);
	const touch = caser(decider);
	const decision = Decision.of(decider);
	return Effect.fnUntraced(function* (path: {
		readonly start: State;
		readonly commands: ReadonlyArray<Command>;
	}): Effect.fn.Return<ReadonlyArray<string>, Broken> {
		const told: Array<Decision.Step<State, Command, Event, Rejection>> = [
			decision.given(path.start)
		];
		const broken = (problem: Problem) =>
			new Broken({
				step: told.length,
				problem,
				counterexample: Decision.lines(Decision.make(title, decider, ...told))
			});
		let state = yield* Effect.mapError(rules.check(path.start), broken);
		const cases = [...touch.state(state)];
		for (const command of path.commands) {
			told.push(decision.when(command));
			const ruled = yield* Effect.mapError(rules.rule(state, command), broken);
			cases.push(...touch.ruled(command, ruled));
			state = ruled.reached;
		}
		return cases;
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
export const check = Effect.fnUntraced(function* (
	exploration: Exploration,
	options?: { readonly replay?: Arbitrary.Replay }
): Effect.fn.Return<Explored, Story.StoryFailure> {
	const { title } = exploration;
	const seen = yield* Ref.make<ReadonlyArray<string>>([]);
	const result = yield* Arbitrary.checkEffect(
		exploration.walks,
		(walk) =>
			walk.pipe(
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
				located(
					exploration,
					new Story.StoryFailure({
						title,
						step: error.step,
						line,
						problem: error.problem.message,
						expected: error.problem.expected,
						actual: error.problem.actual,
						counterexample: error.counterexample,
						replay
					})
				)
			)
		),
		Match.orElse((unfinished) =>
			Effect.fail(
				located(
					exploration,
					new Story.StoryFailure({
						title,
						step: 1,
						line,
						problem: String(Arbitrary.formatCheckFailure(unfinished))
					})
				)
			)
		)
	);
});
