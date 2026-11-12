/**
 * A Loop runs a Program: one fiber applies messages in order, and the app's handler runs the
 * commands. A write runs inside its transition, in the store's transaction with the model; any
 * other command runs as a fiber keyed by its canonical JSON and feeds its messages back. Command
 * fibers only enqueue their messages, so a command its own message cancels or replaces never cuts
 * an apply short, and a message from a command cancelled or replaced since it was enqueued is
 * dropped.
 */
import {
	Cause,
	Deferred,
	Effect,
	Fiber,
	FiberMap,
	Option,
	Queue,
	Scope,
	Stream,
	SubscriptionRef
} from 'effect';
import { stringifier } from './internal/canonical.ts';
import { enforce } from './internal/invariants.ts';
import type { Next, Program, Tagged } from './Program.ts';

/** A command's effect that belongs to its transition, made with `write`. */
export class Write<E, R> {
	readonly effect: Effect.Effect<void, E, R>;
	constructor(effect: Effect.Effect<void, E, R>) {
		this.effect = effect;
	}
}

/**
 * Makes a command's effect part of its transition: it runs in the order `update` listed it,
 * inside the store's transaction with the model, before the model is published or any other
 * command starts. Use it for what must commit or roll back with the model: events into a log, an
 * outbox row, an alarm.
 */
export const write = <E = never, R = never>(effect: Effect.Effect<void, E, R>): Write<E, R> =>
	new Write(effect);

/** What a handler runs as a fiber: an Effect that may answer with a message, or a Stream of them. */
export type Work<Message, E, R> =
	| Effect.Effect<Message | void, E, R>
	| Stream.Stream<Message, E, R>;

/**
 * Runs a command: a write, or work that answers with messages. Map a failure the Program should
 * decide on to a message; any other failure fails the command, and with it `join`, `settled` and
 * `run`. Write it with the Command union's exhaustive `match`, so a new command without a handler
 * does not compile.
 */
export type Handler<Message, Command, E, R> = (
	command: Command
) => Work<Message, E, R> | Write<E, R>;

/**
 * Where the model lives across restarts: `load` gives back exactly what `save` stored, and
 * `transaction` commits a save together with its transition's writes, or neither.
 */
export interface Store<Model, E, R> {
	readonly load: Effect.Effect<Option.Option<Model>, E, R>;
	readonly save: (model: Model) => Effect.Effect<void, E, R>;
	readonly transaction: <A, E2, R2>(
		effect: Effect.Effect<A, E2, R2>
	) => Effect.Effect<A, E | E2, R | R2>;
}

export interface Options<Model, Message, Command extends Tagged, E, R> {
	/** The start when nothing is stored. */
	readonly init: Next<Model, Command>;
	readonly handler: Handler<Message, Command, E, R>;
	readonly store?: Store<Model, E, R>;
}

export interface RunOptions<Model, Message, Command extends Tagged, E, R> extends Options<
	Model,
	Message,
	Command,
	E,
	R
> {
	/** Dispatched in order once the Loop has started. */
	readonly messages?: ReadonlyArray<Message>;
}

export interface Loop<Model, Message, E> {
	/**
	 * Applies a message, commits it and starts its commands; completes once the model is updated,
	 * and fails with a failure of the store or a write, which changes nothing. Once the Loop's scope
	 * has closed it is interrupted.
	 */
	readonly dispatch: (message: Message) => Effect.Effect<void, E>;
	readonly model: Effect.Effect<Model>;
	readonly changes: Stream.Stream<Model>;
	/**
	 * Waits until no command runs and gives the model, or fails as soon as a command fails or dies.
	 */
	readonly settled: Effect.Effect<Model, E>;
	/**
	 * Waits on the Loop's commands: succeeds once its scope has closed, fails as soon as a command
	 * fails or dies, such as a handler that throws or a message that breaks an invariant.
	 */
	readonly join: Effect.Effect<void, E>;
}

interface Delivery<Message, E> {
	readonly message: Message;
	readonly applied: Deferred.Deferred<void, E>;
	/** Whether its sender still runs: always for `dispatch`, for a command while it is not cancelled or replaced. */
	readonly live: Effect.Effect<boolean>;
}

/** A committed transition: its Next and the work it starts, keyed by its command. */
interface Committed<Model, Message, Command, E, R> {
	readonly next: Next<Model, Command>;
	readonly work: ReadonlyMap<string, Work<Message, E, R>>;
}

/**
 * Starts a Loop in the current scope. In one transaction of the store, it loads the stored model
 * and resumes it, otherwise `init` applies. Every transition then checks the Program's invariants
 * on its model, saves it and runs its writes, in one transaction, before it publishes the model
 * and starts the rest of its commands. A model that breaks an invariant dies with
 * `Program.InvariantBroken`, and a failing save or write fails the transition; either changes
 * nothing. Closing the scope applies the messages already dispatched, then interrupts every
 * command.
 */
export const make = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	E = never,
	R = never
>(
	program: Program<Model, Message, Command>,
	options: Options<Model, Message, Command, E, R>
): Effect.fn.Return<Loop<Model, Message, E>, E, Scope.Scope | R> {
	const { handler, store } = options;
	const context = yield* Effect.context<R>();
	const keyOf = stringifier(program.Command);
	const holds = enforce(program.invariants, program.Model);
	const transaction: Store<Model, E, R>['transaction'] = store
		? store.transaction
		: (effect) => effect;
	// The Loop's own scope releases in order whatever the caller's strategy: the deliveries drain
	// before the FiberMap interrupts the commands they started.
	const scope = yield* Scope.fork(yield* Effect.scope, 'sequential');
	const fibers = yield* Scope.provide(FiberMap.make<string, void, E>(), scope);
	const deliveries = yield* Queue.unbounded<Delivery<Message, E>, Cause.Done>();

	const commit = Effect.fnUntraced(function* (next: Next<Model, Command>) {
		yield* holds(next.model);
		if (store) yield* store.save(next.model);
		// Identical commands are one, as in a story: each runs once, where it first appears.
		const commands = new Map((next.commands ?? []).map((command) => [keyOf(command), command]));
		const work = new Map<string, Work<Message, E, R>>();
		for (const [key, command] of commands) {
			const output = handler(command);
			if (output instanceof Write) yield* output.effect;
			else work.set(key, output);
		}
		return { next, work } satisfies Committed<Model, Message, Command, E, R>;
	});

	const first = yield* transaction(
		Effect.flatMap(store ? store.load : Effect.succeedNone, (stored) =>
			commit(Option.match(stored, { onNone: () => options.init, onSome: program.resume }))
		)
	);
	const model = yield* SubscriptionRef.make(first.next.model);

	const sender = (live: Effect.Effect<boolean>) =>
		Effect.fnUntraced(function* (message: Message) {
			const applied = yield* Deferred.make<void, E>();
			const open = yield* Queue.offer(deliveries, { message, applied, live });
			return yield* open ? Deferred.await(applied) : Effect.interrupt;
		});

	const run = (work: Work<Message, E, R>, key: string): Effect.Effect<void, E, R> =>
		Effect.withFiber((fiber) => {
			const send = sender(
				Effect.map(
					FiberMap.get(fibers, key),
					Option.exists((running) => running === fiber)
				)
			);
			return Stream.isStream(work)
				? Stream.runForEach(work, send)
				: Effect.flatMap(work, (message) => (message === undefined ? Effect.void : send(message)));
		});

	const enact = Effect.fnUntraced(function* ({
		next,
		work
	}: Committed<Model, Message, Command, E, R>) {
		yield* SubscriptionRef.set(model, next.model);
		// The new commands start before the cancelled ones stop, so the map empties only once the
		// process is idle, even when a reply cancels its own command. A key both cancelled and
		// started is replaced by its new fiber.
		for (const [key, output] of work) yield* FiberMap.run(fibers, key, run(output, key));
		for (const command of next.cancels ?? []) {
			const key = keyOf(command);
			if (!work.has(key)) yield* FiberMap.remove(fibers, key);
		}
	}, Effect.provideContext(context));

	const deliver = Effect.fnUntraced(function* ({ message, applied, live }: Delivery<Message, E>) {
		const exit = yield* Effect.exit(
			transaction(
				Effect.flatMap(SubscriptionRef.get(model), (current) =>
					commit(program.update(current, message))
				)
			).pipe(
				Effect.provideContext(context),
				Effect.flatMap(enact),
				Effect.when(live),
				Effect.asVoid
			)
		);
		yield* Deferred.done(applied, exit);
	});

	yield* enact(first);
	yield* Scope.provide(
		Effect.acquireRelease(
			Effect.forkDetach(Stream.runForEach(Stream.fromQueue(deliveries), deliver)),
			(applying) => Effect.andThen(Queue.end(deliveries), Fiber.await(applying))
		),
		scope
	);

	const join = FiberMap.join(fibers);

	return {
		dispatch: sender(Effect.succeed(true)),
		model: SubscriptionRef.get(model),
		changes: SubscriptionRef.changes(model),
		// A failing fiber completes `join` as it leaves the map, so `join` wins the race against
		// `awaitEmpty` whenever a command failed.
		settled: Effect.raceFirst(join, FiberMap.awaitEmpty(fibers)).pipe(
			Effect.andThen(SubscriptionRef.get(model))
		),
		join
	};
});

/**
 * Runs a Program to the end in a scope of its own: starts a Loop, dispatches `messages` in order
 * and gives the model once no command runs, traced as the span `Loop.run`. Fails with the first
 * failure of a dispatch or a command, which dispatches nothing more and interrupts the commands
 * still running.
 */
export const run = Effect.fn('Loop.run')(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	E = never,
	R = never
>(
	program: Program<Model, Message, Command>,
	options: RunOptions<Model, Message, Command, E, R>
): Effect.fn.Return<Model, E, Scope.Scope | R> {
	const loop = yield* make(program, options);
	// `join` succeeds only once this scope closes, so here it ends only with the first failure,
	// which stops the dispatches still to come.
	return yield* Effect.raceFirst(
		Effect.andThen(loop.join, Effect.never),
		Effect.gen(function* () {
			for (const message of options.messages ?? []) yield* loop.dispatch(message);
			return yield* loop.settled;
		})
	);
}, Effect.scoped);
