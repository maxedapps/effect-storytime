/**
 * A Program's steps with every strict rule, shared by authored stories and explored paths. Each
 * step takes the state so far and gives the next, or fails with a Problem.
 */
import { Effect, identity, Option, Schema } from 'effect';
import type { Next, Program, Tagged } from '../../Program.ts';
import { tagger } from '../../internal/canonical.ts';
import { holds, Problem, pure, role } from './check.ts';

interface Pending<Command> {
	readonly key: string;
	readonly command: Command;
	/** Produced and not yet named by a step. */
	readonly owed: boolean;
}

export interface State<Model, Command> {
	readonly model: Model;
	readonly pending: ReadonlyArray<Pending<Command>>;
	/** Keys cancelled since the enclosing `anyOrder` began, whose replies it skips; none outside one. */
	readonly cancelled: Option.Option<ReadonlyArray<string>>;
	readonly cases: ReadonlyArray<string>;
}

/** One `update` a step ran: the model before, the message, and the model, commands and cancels it gave. */
export interface Update<Model, Message, Command> {
	readonly before: Model;
	readonly message: Message;
	readonly after: Model;
	readonly commands: ReadonlyArray<Command>;
	readonly cancels: ReadonlyArray<Command>;
}

const tagOf = (value: Tagged) => value._tag;

/**
 * The steps of `program`. With `owing`, every produced command is owed an assertion; explored
 * paths assert no effects, so they owe none, and check their `properties` on every update instead.
 */
export const machine = <Model, Message extends Tagged, Command extends Tagged>(
	program: Program<Model, Message, Command>,
	owing: boolean,
	properties: Readonly<Record<string, (update: Update<Model, Message, Command>) => boolean>> = {}
) => {
	const the = {
		model: role(program.Model, 'the model'),
		message: role(program.Message, 'the message'),
		command: role(program.Command, 'the command')
	};
	const invariants = holds('invariant', program.invariants, program.Model);
	const updates = holds(
		'property',
		properties,
		Schema.Struct({
			before: program.Model,
			message: program.Message,
			after: program.Model,
			commands: Schema.Array(program.Command),
			cancels: Schema.Array(program.Command)
		})
	);
	const modelTag = tagger(program.Model);
	const modelCase = (value: Model) =>
		Option.match(modelTag(value), { onNone: () => [], onSome: (tag) => [`Model.${tag}`] });

	const pendingLines = (pending: ReadonlyArray<Pending<Command>>) =>
		pending
			.map((entry) => the.command.show(entry.command))
			.toSorted()
			.join('\n');

	const output = Effect.fnUntraced(function* (next: Next<Model, Command>) {
		yield* the.model.valid(next.model);
		yield* Effect.forEach(next.commands ?? [], the.command.valid);
		yield* Effect.forEach(next.cancels ?? [], the.command.valid);
		return JSON.stringify({
			model: yield* the.model.key(next.model),
			commands: yield* Effect.forEach(next.commands ?? [], the.command.key),
			cancels: yield* Effect.forEach(next.cancels ?? [], the.command.key)
		});
	});

	const settle = Effect.fnUntraced(function* (
		state: State<Model, Command>,
		next: Next<Model, Command>
	) {
		let pending = state.pending;
		let cancelled = state.cancelled;
		for (const command of next.cancels ?? []) {
			const key = yield* the.command.key(command);
			if (pending.some((entry) => entry.key === key && entry.owed)) {
				return yield* new Problem({
					message: `${the.command.show(command)} was cancelled before any step asserted it`
				});
			}
			pending = pending.filter((entry) => entry.key !== key);
			cancelled = Option.map(cancelled, (keys) => [...keys, key]);
		}
		for (const command of next.commands ?? []) {
			const key = yield* the.command.key(command);
			pending = [...pending.filter((entry) => entry.key !== key), { key, command, owed: owing }];
		}
		const model = yield* the.model.copy(next.model);
		yield* invariants(model);
		return {
			model,
			pending,
			cancelled,
			cases: [
				...state.cases,
				...modelCase(next.model),
				...(next.commands ?? []).map((command) => `Command.${tagOf(command)}`)
			]
		};
	});

	/** Runs `update` on a copy of a message, so a mutation never reaches the story's own. */
	const send = Effect.fnUntraced(function* (state: State<Model, Command>, message: Message) {
		yield* the.message.valid(message);
		const copy = yield* the.message.copy(message);
		const next = yield* pure(
			'update',
			Effect.map(
				Effect.all([the.model.key(state.model), the.message.key(copy)]),
				([model, sent]) => model + sent
			),
			() => program.update(state.model, copy),
			output
		);
		const settled = yield* settle(
			{ ...state, cases: [...state.cases, `Message.${tagOf(message)}`] },
			next
		);
		yield* updates({
			before: state.model,
			message: copy,
			after: settled.model,
			commands: next.commands ?? [],
			cancels: next.cancels ?? []
		});
		return settled;
	});

	/**
	 * Finds a pending command by its key. A command cancelled earlier in the same `anyOrder` gives
	 * none, so its reply is skipped.
	 */
	const take = Effect.fnUntraced(function* (state: State<Model, Command>, command: Command) {
		yield* the.command.valid(command);
		const key = yield* the.command.key(command);
		const found = state.pending.find((entry) => entry.key === key);
		if (found) return Option.some(key);
		if (Option.exists(state.cancelled, (keys) => keys.includes(key))) return Option.none<string>();
		return yield* new Problem({
			message: `${the.command.show(command)} is not pending`,
			expected: the.command.show(command),
			actual: pendingLines(state.pending)
		});
	});

	return {
		pendingLines,

		/**
		 * The state a story starts from, once the model passes every check. It holds the model's
		 * decoded copy, so a callback that mutates it never changes the story's own.
		 */
		start: Effect.fnUntraced(function* (model: Model) {
			yield* the.model.valid(model);
			const copy = yield* the.model.copy(model);
			yield* invariants(copy);
			return identity<State<Model, Command>>({
				model: copy,
				pending: [],
				cancelled: Option.none(),
				cases: modelCase(copy)
			});
		}),

		send,

		model: Effect.fnUntraced(function* (state: State<Model, Command>, expected: Model) {
			yield* the.model.valid(expected);
			if ((yield* the.model.key(expected)) !== (yield* the.model.key(state.model))) {
				return yield* new Problem({
					message: 'the model differs',
					expected: the.model.show(expected),
					actual: the.model.show(state.model)
				});
			}
			return state;
		}),

		satisfies: (state: State<Model, Command>, label: string, check: (model: Model) => boolean) =>
			Effect.as(the.model.satisfies(state.model, label, check), state),

		commands: Effect.fnUntraced(function* (
			state: State<Model, Command>,
			expected: ReadonlyArray<Command>
		) {
			yield* Effect.forEach(expected, the.command.valid);
			const wanted = (yield* Effect.forEach(expected, the.command.key)).toSorted();
			const actual = state.pending.map((entry) => entry.key).toSorted();
			if (wanted.join('\n') !== actual.join('\n')) {
				return yield* new Problem({
					message: 'the pending commands differ',
					expected: expected.map(the.command.show).toSorted().join('\n'),
					actual: pendingLines(state.pending)
				});
			}
			return { ...state, pending: state.pending.map((entry) => ({ ...entry, owed: false })) };
		}),

		/** Completes a pending command and feeds its reply, if any. */
		resolve: (state: State<Model, Command>, command: Command, reply: Option.Option<Message>) =>
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
							onSome: (message) => send(remaining, message)
						});
					}
				})
			),

		/** Feeds a message from a pending streaming command, which stays pending. */
		emit: (state: State<Model, Command>, command: Command, message: Message) =>
			Effect.flatMap(take(state, command), (key) =>
				Option.match(key, {
					onNone: () => Effect.succeed(state),
					onSome: (running) =>
						send(
							{
								...state,
								pending: state.pending.map((entry) =>
									entry.key === running ? { ...entry, owed: false } : entry
								)
							},
							message
						)
				})
			),

		/** Round-trips the model through JSON, drops every pending command and applies `resume`. */
		restart: Effect.fnUntraced(function* (state: State<Model, Command>) {
			const owed = state.pending.filter((entry) => entry.owed);
			if (owed.length > 0) {
				return yield* new Problem({
					message: 'the restart drops commands no step asserted',
					actual: pendingLines(owed)
				});
			}
			const stored = yield* the.model.copy(state.model);
			const next = yield* pure(
				'resume',
				the.model.key(stored),
				() => program.resume(stored),
				output
			);
			return yield* settle({ ...state, model: stored, pending: [] }, next);
		})
	};
};
