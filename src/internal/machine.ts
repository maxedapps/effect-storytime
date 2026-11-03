/**
 * A Program's steps with every strict rule, shared by authored stories and explored paths. Each
 * step takes the state so far and gives the next, or fails with a Problem.
 */
import { Effect, identity, Option } from 'effect';
import type { Next, Program, Tagged } from '../Program.ts';
import { describer, stringifier, tagger } from './canonical.ts';
import { attempt, conforms, holds, Problem, pure, roundTrips } from './check.ts';

interface Pending<Command> {
	readonly key: string;
	readonly command: Command;
	/** Produced and not yet named by a step. */
	readonly owed: boolean;
}

export interface State<Model, Command> {
	readonly model: Model;
	readonly pending: ReadonlyArray<Pending<Command>>;
	/** Keys cancelled since the enclosing `anyOrder` began; none outside one. */
	readonly cancelled: Option.Option<ReadonlyArray<string>>;
	readonly cases: ReadonlyArray<string>;
}

const tagOf = (value: Tagged) => value._tag;

/**
 * The steps of `program`. With `owing`, every produced command is owed an assertion; explored
 * paths assert no effects, so they owe none.
 */
export const machine = <Model, Message extends Tagged, Command extends Tagged>(
	program: Program<Model, Message, Command>,
	owing: boolean
) => {
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
			pending = [...pending.filter((entry) => entry.key !== key), { key, command, owed: owing }];
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

	/** Runs `update` on a message. */
	const send = Effect.fnUntraced(function* (state: State<Model, Command>, message: Message) {
		yield* validMessage(message);
		const next = yield* pure(
			'update',
			() => modelKey(state.model) + messageKey(message),
			() => program.update(state.model, message),
			output
		);
		return yield* settle({ ...state, cases: [...state.cases, `Message.${tagOf(message)}`] }, next);
	});

	/**
	 * Finds a pending command by its key. A command cancelled earlier in the same `anyOrder` gives
	 * none, so its reply is skipped.
	 */
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

	return {
		pendingLines,

		/** The state a story starts from, once the model passes every check. */
		start: (model: Model) =>
			Effect.as(
				Effect.all([validModel(model), durable(model), invariants(model)]),
				identity<State<Model, Command>>({
					model,
					pending: [],
					cancelled: Option.none(),
					cases: modelCase(model)
				})
			),

		send,

		model: (state: State<Model, Command>, expected: Model) =>
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
			}),

		satisfies: (state: State<Model, Command>, label: string, check: (model: Model) => boolean) =>
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
			),

		commands: (state: State<Model, Command>, expected: ReadonlyArray<Command>) =>
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
		restart: (state: State<Model, Command>) =>
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
	};
};
