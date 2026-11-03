/**
 * A story tells how a Program behaves, as steps: start from a model, send messages, and account
 * for every command it asks for. Running it checks each step and the strict rules in between.
 */
import { Array as Arr, Data, Effect, Option, Schema } from 'effect';
import { describer, stringifier, tagger } from './internal/canonical.ts';
import { attempt, conforms, holds, Problem, pure, roundTrips } from './internal/check.ts';
import type { Next, Program, Tagged } from './Program.ts';

export type Step<Model, Message, Command> = Data.TaggedEnum<{
	Given: { readonly model: Model };
	Send: { readonly message: Message };
	Model: { readonly expected: Model };
	Satisfies: { readonly label: string; readonly check: (model: Model) => boolean };
	Commands: { readonly commands: ReadonlyArray<Command> };
	Resolve: { readonly command: Command; readonly reply: Option.Option<Message> };
	Emit: { readonly command: Command; readonly message: Message };
	// oxlint-disable-next-line typescript/no-empty-object-type -- TaggedEnum spells a case without fields as {}
	Restart: {};
	AnyOrder: { readonly steps: Steps<Model, Message, Command> };
	Group: { readonly steps: Steps<Model, Message, Command> };
}>;

export type Steps<Model, Message, Command> = ReadonlyArray<Step<Model, Message, Command>>;

interface StepDefinition extends Data.TaggedEnum.WithGenerics<3> {
	readonly taggedEnum: Step<this['A'], this['B'], this['C']>;
}

const Step = Data.taggedEnum<StepDefinition>();

/** Starts the story from a model. It comes first and only once. */
export const given = <Model = never, Message = never, Command = never>(
	model: NoInfer<Model>
): Step<Model, Message, Command> => Step.Given({ model });

/** Sends a message through `update`. */
export const send = <Model = never, Message = never, Command = never>(
	message: NoInfer<Message>
): Step<Model, Message, Command> => Step.Send({ message });

/** Requires the model to equal `expected`. */
export const model = <Model = never, Message = never, Command = never>(
	expected: NoInfer<Model>
): Step<Model, Message, Command> => Step.Model({ expected });

/** Requires the model to pass a check, shown in story lines by its label. */
export const satisfies = <Model = never, Message = never, Command = never>(
	label: string,
	check: (model: NoInfer<Model>) => boolean
): Step<Model, Message, Command> => Step.Satisfies({ label, check });

/** Requires exactly these commands to be pending, in any order; `commands()` means none. */
export const commands = <Model = never, Message = never, Command = never>(
	...expected: ReadonlyArray<NoInfer<Command>>
): Step<Model, Message, Command> => Step.Commands({ commands: expected });

/** Completes a pending command and feeds its reply, if it has one, through `update`. */
export const resolve = <Model = never, Message = never, Command = never>(
	command: NoInfer<Command>,
	reply?: NoInfer<Message>
): Step<Model, Message, Command> => Step.Resolve({ command, reply: Option.fromUndefinedOr(reply) });

/** Feeds one message from a pending streaming command, which stays pending. */
export const emit = <Model = never, Message = never, Command = never>(
	command: NoInfer<Command>,
	message: NoInfer<Message>
): Step<Model, Message, Command> => Step.Emit({ command, message });

/**
 * Restarts as after a crash: the model goes through JSON, every pending command is dropped and
 * `resume` decides what to redo.
 */
export const restart = <Model = never, Message = never, Command = never>(): Step<
	Model,
	Message,
	Command
> => Step.Restart();

/**
 * Runs the rest of the story once per order of these 2 to 5 steps. A `resolve` or `emit` is
 * skipped when its command was cancelled earlier in the same order.
 */
export const anyOrder = <Model = never, Message = never, Command = never>(
	...steps: Steps<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>
): Step<Model, Message, Command> => Step.AnyOrder({ steps });

/** Groups steps, so a story can share a common part. */
export const steps = <Model = never, Message = never, Command = never>(
	...grouped: Steps<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>
): Step<Model, Message, Command> => Step.Group({ steps: grouped });

export class Story<Model, Message extends Tagged, Command extends Tagged> extends Data.TaggedClass(
	'Story'
)<{
	readonly title: string;
	readonly program: Program<Model, Message, Command>;
	readonly steps: Steps<Model, Message, Command>;
}> {}

export const make = <Model, Message extends Tagged, Command extends Tagged>(
	title: string,
	program: Program<Model, Message, Command>,
	...body: Steps<Model, Message, Command>
): Story<Model, Message, Command> => new Story({ title, program, steps: body });

/** A failed story, with the step (its line number in `lines`) where it failed. */
export class StoryFailure extends Schema.TaggedError<StoryFailure>()('StoryFailure', {
	title: Schema.String,
	step: Schema.Int,
	line: Schema.String,
	message: Schema.String,
	expected: Schema.optional(Schema.String),
	actual: Schema.optional(Schema.String),
	counterexample: Schema.optional(Schema.Array(Schema.String)),
	replay: Schema.optional(Schema.String)
}) {}

/** What a passing story reached: its final model and the cases it sent, produced or reached. */
const tagOf = (value: Tagged) => value._tag;

export interface Outcome<Model> {
	readonly model: Model;
	readonly cases: ReadonlyArray<string>;
}

/**
 * A step placed in its story: its number and line in `lines`, and the entries inside a group
 * (inlined, with no line of its own) or an `anyOrder` (one unit each).
 */
interface Entry<Model, Message, Command> {
	readonly no: number;
	readonly depth: number;
	readonly line: string;
	readonly step: Step<Model, Message, Command>;
	readonly children: ReadonlyArray<Entry<Model, Message, Command>>;
}

const layout = <Model, Message extends Tagged, Command extends Tagged>(
	program: Program<Model, Message, Command>,
	body: Steps<Model, Message, Command>
): ReadonlyArray<Entry<Model, Message, Command>> => {
	const showModel = describer(program.Model);
	const showMessage = describer(program.Message);
	const showCommand = describer(program.Command);
	let next = 1;
	const place = (
		depth: number,
		group: Steps<Model, Message, Command>
	): ReadonlyArray<Entry<Model, Message, Command>> =>
		group.map((step) => {
			const leaf = (line: string) => ({ no: next++, depth, line, step, children: [] });
			return Step.$match(step, {
				Given: ({ model: start }) => leaf(`given ${showModel(start)}`),
				Send: ({ message }) => leaf(`send ${showMessage(message)}`),
				Model: ({ expected }) => leaf(`model ${showModel(expected)}`),
				Satisfies: ({ label }) => leaf(`satisfies ${label}`),
				Commands: ({ commands: expected }) =>
					leaf(`commands ${expected.length === 0 ? 'none' : expected.map(showCommand).join(', ')}`),
				Resolve: ({ command, reply }) =>
					leaf(
						`resolve ${showCommand(command)}${Option.match(reply, {
							onNone: () => '',
							onSome: (message) => ` → ${showMessage(message)}`
						})}`
					),
				Emit: ({ command, message }) =>
					leaf(`emit ${showCommand(command)} → ${showMessage(message)}`),
				Restart: () => leaf('restart'),
				AnyOrder: ({ steps: units }) => ({
					no: next++,
					depth,
					line: 'any order',
					step,
					children: place(depth + 1, units)
				}),
				Group: ({ steps: inner }) => ({
					no: next,
					depth,
					// Stryker disable next-line StringLiteral: a group has no line of its own, so none shows it
					line: '',
					step,
					children: place(depth, inner)
				})
			});
		});
	return place(0, body);
};

/** Every entry that has a line, in story order. */
const flatten = <Model, Message, Command>(
	entries: ReadonlyArray<Entry<Model, Message, Command>>
): ReadonlyArray<Entry<Model, Message, Command>> =>
	entries.flatMap((entry) =>
		Step.$is('Group')(entry.step) ? flatten(entry.children) : [entry, ...flatten(entry.children)]
	);

/** Renders a story as plain lines, from its value alone. */
export const lines = <Model, Message extends Tagged, Command extends Tagged>(
	story: Story<Model, Message, Command>
): ReadonlyArray<string> =>
	flatten(layout(story.program, story.steps)).map(
		(entry) => `${'  '.repeat(entry.depth)}${entry.line}`
	);

const permutations = <A>(items: ReadonlyArray<A>): Arr.NonEmptyReadonlyArray<ReadonlyArray<A>> =>
	Arr.match(items, {
		onEmpty: () => [[]],
		onNonEmpty: (some) =>
			Arr.flatMap(some, (item, index) =>
				Arr.map(permutations(Arr.remove(some, index)), (rest) => [item, ...rest])
			)
	});

interface Pending<Command> {
	readonly key: string;
	readonly command: Command;
	readonly owed: boolean;
}

interface State<Model, Command> {
	readonly model: Model;
	readonly pending: ReadonlyArray<Pending<Command>>;
	/** Keys cancelled since the enclosing `anyOrder` began; none outside one. */
	readonly cancelled: Option.Option<ReadonlyArray<string>>;
	readonly cases: ReadonlyArray<string>;
}

/** Runs a story: every step and every strict rule, once per order of each `anyOrder`. */
export const run = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged
>(story: Story<Model, Message, Command>): Effect.fn.Return<Outcome<Model>, StoryFailure> {
	const { program, title } = story;
	const entries = layout(program, story.steps);
	const all = flatten(entries);
	const showModel = describer(program.Model);
	const showCommand = describer(program.Command);
	const modelKey = stringifier(program.Model);
	const commandKey = stringifier(program.Command);
	const messageKey = stringifier(program.Message);
	const validModel = conforms(program.Model, 'the model');
	const validMessage = conforms(program.Message, 'the message');
	const validCommand = conforms(program.Command, 'the command');
	const durable = roundTrips(program.Model, 'the model');
	const invariants = holds(program.invariants, showModel);
	const modelTag = tagger(program.Model);
	const modelCase = (value: Model) =>
		Option.match(modelTag(value), { onNone: () => [], onSome: (tag) => [`Model.${tag}`] });

	const fail =
		(entry: { readonly no: number; readonly line: string }, order: string) => (problem: Problem) =>
			new StoryFailure({
				title,
				step: entry.no,
				line: entry.line,
				message: `${order}${problem.message}`,
				expected: problem.expected,
				actual: problem.actual
			});

	const pendingLines = (pending: ReadonlyArray<Pending<Command>>) =>
		pending
			.map((entry) => showCommand(entry.command))
			.toSorted()
			.join('\n');

	const output = (next: Next<Model, Command>) =>
		Effect.gen(function* () {
			yield* validModel(next.model);
			yield* Effect.forEach(next.commands ?? [], validCommand);
			yield* Effect.forEach(next.cancels ?? [], validCommand);
			return JSON.stringify({
				model: modelKey(next.model),
				commands: (next.commands ?? []).map(commandKey),
				cancels: (next.cancels ?? []).map(commandKey)
			});
		});

	const settle = Effect.fnUntraced(function* (
		state: State<Model, Command>,
		next: Next<Model, Command>
	) {
		let pending = state.pending;
		let cancelled = state.cancelled;
		for (const command of next.cancels ?? []) {
			const key = commandKey(command);
			const found = pending.find((entry) => entry.key === key);
			// Inside anyOrder a command one order produced can't be asserted by the shared steps.
			if (found?.owed && Option.isNone(cancelled)) {
				return yield* new Problem({
					message: `${showCommand(command)} was cancelled before any step asserted it`
				});
			}
			pending = pending.filter((entry) => entry.key !== key);
			cancelled = Option.map(cancelled, (keys) => [...keys, key]);
		}
		for (const command of next.commands ?? []) {
			const key = commandKey(command);
			pending = [...pending.filter((entry) => entry.key !== key), { key, command, owed: true }];
		}
		yield* durable(next.model);
		yield* invariants(next.model);
		return {
			model: next.model,
			pending,
			cancelled,
			cases: [
				...state.cases,
				...modelCase(next.model),
				...(next.commands ?? []).map((command) => `Command.${tagOf(command)}`)
			]
		};
	});

	const deliver = Effect.fnUntraced(function* (state: State<Model, Command>, message: Message) {
		yield* validMessage(message);
		const next = yield* pure(
			'update',
			() => modelKey(state.model) + messageKey(message),
			() => program.update(state.model, message),
			output
		);
		return yield* settle({ ...state, cases: [...state.cases, `Message.${tagOf(message)}`] }, next);
	});

	const take = (state: State<Model, Command>, command: Command) => {
		const key = commandKey(command);
		return Effect.gen(function* () {
			yield* validCommand(command);
			const found = state.pending.find((entry) => entry.key === key);
			if (found) return Option.some(key);
			if (Option.exists(state.cancelled, (keys) => keys.includes(key))) return Option.none();
			return yield* new Problem({
				message: `${showCommand(command)} is not pending`,
				expected: showCommand(command),
				actual: pendingLines(state.pending)
			});
		});
	};

	const end = { no: all.length + 1, line: 'end' };

	const finish = (state: State<Model, Command>, order: string) => {
		const owed = state.pending.filter((entry) => entry.owed);
		return owed.length === 0
			? Effect.succeed(Arr.of(state))
			: Effect.fail(
					fail(
						end,
						order
					)(
						new Problem({
							message: `the story ended with ${owed.length} unasserted command(s)`,
							actual: pendingLines(owed)
						})
					)
				);
	};

	const [first] = all;

	const go = (
		state: State<Model, Command>,
		queue: ReadonlyArray<Entry<Model, Message, Command>>,
		order: string
	): Effect.Effect<Arr.NonEmptyReadonlyArray<State<Model, Command>>, StoryFailure> => {
		const [head, ...rest] = queue;
		if (head === undefined) return finish(state, order);
		const then = (next: Effect.Effect<State<Model, Command>, Problem>) =>
			next.pipe(
				Effect.mapError(fail(head, order)),
				Effect.flatMap((reached) => go(reached, rest, order))
			);
		return Step.$match(head.step, {
			Given: () =>
				head === first
					? go(state, rest, order)
					: then(Effect.fail(new Problem({ message: 'given(model) comes once, first' }))),
			Send: ({ message }) => then(deliver(state, message)),
			Model: ({ expected }) =>
				then(
					Effect.gen(function* () {
						yield* validModel(expected);
						if (modelKey(expected) !== modelKey(state.model)) {
							return yield* new Problem({
								message: 'the model differs',
								expected: showModel(expected),
								actual: showModel(state.model)
							});
						}
						return state;
					})
				),
			Satisfies: ({ label, check }) =>
				then(
					Effect.flatMap(
						attempt(label, () => check(state.model)),
						(ok) =>
							ok
								? Effect.succeed(state)
								: Effect.fail(
										new Problem({
											message: `the model does not satisfy ${label}`,
											actual: showModel(state.model)
										})
									)
					)
				),
			Commands: ({ commands: expected }) =>
				then(
					Effect.gen(function* () {
						yield* Effect.forEach(expected, validCommand);
						const wanted = expected.map(commandKey).toSorted();
						const actual = state.pending.map((entry) => entry.key).toSorted();
						if (wanted.join('\n') !== actual.join('\n')) {
							return yield* new Problem({
								message: 'the pending commands differ',
								expected: expected.map(showCommand).toSorted().join('\n'),
								actual: pendingLines(state.pending)
							});
						}
						return { ...state, pending: state.pending.map((entry) => ({ ...entry, owed: false })) };
					})
				),
			Resolve: ({ command, reply }) =>
				then(
					Effect.flatMap(take(state, command), (key) =>
						Option.match(key, {
							onNone: () => Effect.succeed(state),
							onSome: (done) => {
								const remaining = {
									...state,
									pending: state.pending.filter((entry) => entry.key !== done)
								};
								return Option.match(reply, {
									onNone: () => Effect.succeed(remaining),
									onSome: (message) => deliver(remaining, message)
								});
							}
						})
					)
				),
			Emit: ({ command, message }) =>
				then(
					Effect.flatMap(take(state, command), (key) =>
						Option.match(key, {
							onNone: () => Effect.succeed(state),
							onSome: (running) =>
								deliver(
									{
										...state,
										pending: state.pending.map((entry) =>
											entry.key === running ? { ...entry, owed: false } : entry
										)
									},
									message
								)
						})
					)
				),
			Restart: () =>
				then(
					Effect.gen(function* () {
						const owed = state.pending.filter((entry) => entry.owed);
						if (owed.length > 0) {
							return yield* new Problem({
								message: 'the restart drops commands no step asserted',
								actual: pendingLines(owed)
							});
						}
						const stored = yield* durable(state.model);
						const next = yield* pure(
							'resume',
							() => modelKey(stored),
							() => program.resume(stored),
							output
						);
						return yield* settle({ ...state, model: stored, pending: [] }, next);
					})
				),
			AnyOrder: () =>
				Effect.map(
					Effect.forEach(permutations(head.children), (units) =>
						go(
							{
								...state,
								// Stryker disable next-line ArrayDeclaration: no command has an unknown key, so it never matches
								cancelled: Option.orElseSome(state.cancelled, () => [])
							},
							[...units, ...rest],
							`${order}in order ${flatten(units)
								.map((entry) => entry.no)
								.join(', ')}: `
						)
					),
					Arr.flatten
				),
			Group: () => go(state, [...head.children, ...rest], order)
		});
	};

	if (first === undefined || !Step.$is('Given')(first.step)) {
		return yield* fail(
			first ?? { no: 1, line: '' },
			''
		)(new Problem({ message: 'a story starts with given(model)' }));
	}
	const crowded = all.find(
		(entry) =>
			Step.$is('AnyOrder')(entry.step) && (entry.children.length < 2 || entry.children.length > 5)
	);
	if (crowded) {
		return yield* fail(crowded, '')(new Problem({ message: 'anyOrder takes 2 to 5 steps' }));
	}
	const start = first.step.model;
	yield* Effect.all([validModel(start), durable(start), invariants(start)]).pipe(
		Effect.mapError(fail(first, ''))
	);
	const finals = yield* go(
		{ model: start, pending: [], cancelled: Option.none(), cases: modelCase(start) },
		entries,
		''
	);
	return {
		model: finals[0].model,
		cases: Arr.dedupe(finals.flatMap((final) => final.cases)).toSorted()
	};
});
