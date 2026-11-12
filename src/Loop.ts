/**
 * A Loop runs a Program: one fiber applies messages in order, commands run as fibers keyed by
 * their canonical JSON, and an optional store keeps the model across restarts. Command fibers
 * only enqueue their messages, so a command its own message cancels or replaces never cuts an
 * apply short, and a message from a command cancelled or replaced since it was enqueued is dropped.
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
import type { Next, Program, Tagged } from './Program.ts';

/**
 * Runs a command: an Effect that may answer with a message, or a Stream of them. Failures must
 * become messages, so the Program decides what they mean. Write it with the Command union's
 * exhaustive `match`, so a new command without a handler does not compile.
 */
export type Handler<Message, Command, R> = (
	command: Command
) => Effect.Effect<Message | void, never, R> | Stream.Stream<Message, never, R>;

/** Where the model lives across restarts. Infrastructure failures are defects by then. */
export interface Persist<Model, R> {
	readonly load: Effect.Effect<Option.Option<Model>, never, R>;
	readonly save: (model: Model) => Effect.Effect<void, never, R>;
}

export interface Options<Model, Message, Command extends Tagged, R> {
	/** The start when nothing is stored. */
	readonly init: Next<Model, Command>;
	readonly handler: Handler<Message, Command, R>;
	readonly persist?: Persist<Model, R>;
}

export interface Loop<Model, Message> {
	/**
	 * Applies a message and starts its commands; completes once the model is updated. Once the
	 * Loop's scope has closed it is interrupted.
	 */
	readonly dispatch: (message: Message) => Effect.Effect<void>;
	readonly model: Effect.Effect<Model>;
	readonly changes: Stream.Stream<Model>;
}

interface Delivery<Message> {
	readonly message: Message;
	readonly applied: Deferred.Deferred<void>;
	/** Whether its sender still runs: always for `dispatch`, for a command while it is not cancelled or replaced. */
	readonly live: Effect.Effect<boolean>;
}

/**
 * Starts a Loop in the current scope. A stored model is resumed, otherwise `init` applies. Each
 * model is saved before its commands start. Closing the scope applies the messages already
 * dispatched, then interrupts every command.
 */
export const make = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	R = never
>(
	program: Program<Model, Message, Command>,
	options: Options<Model, Message, Command, R>
): Effect.fn.Return<Loop<Model, Message>, never, Scope.Scope | R> {
	const context = yield* Effect.context<R>();
	const keyOf = stringifier(program.Command);
	const stored = options.persist ? yield* options.persist.load : Option.none<Model>();
	const start = Option.match(stored, { onNone: () => options.init, onSome: program.resume });
	const model = yield* SubscriptionRef.make(start.model);
	// The Loop's own scope releases in order whatever the caller's strategy: the deliveries drain
	// before the FiberMap interrupts the commands they started.
	const scope = yield* Scope.fork(yield* Effect.scope, 'sequential');
	const fibers = yield* Scope.provide(FiberMap.make<string>(), scope);
	const deliveries = yield* Queue.unbounded<Delivery<Message>, Cause.Done>();

	const sender = (live: Effect.Effect<boolean>) => (message: Message) =>
		Effect.gen(function* () {
			const applied = yield* Deferred.make<void>();
			const open = yield* Queue.offer(deliveries, { message, applied, live });
			return yield* open ? Deferred.await(applied) : Effect.interrupt;
		});

	const run = (command: Command, key: string): Effect.Effect<void, never, R> =>
		Effect.withFiber((fiber) => {
			const send = sender(
				Effect.map(
					FiberMap.get(fibers, key),
					Option.exists((running) => running === fiber)
				)
			);
			const output = options.handler(command);
			return Stream.isStream(output)
				? Stream.runForEach(output, send)
				: Effect.flatMap(output, (message) =>
						message === undefined ? Effect.void : send(message)
					);
		});

	const apply = Effect.fnUntraced(function* (next: Next<Model, Command>) {
		if (options.persist) yield* options.persist.save(next.model);
		yield* SubscriptionRef.set(model, next.model);
		for (const command of next.cancels ?? []) yield* FiberMap.remove(fibers, keyOf(command));
		for (const command of next.commands ?? []) {
			const key = keyOf(command);
			yield* FiberMap.run(fibers, key, run(command, key));
		}
	}, Effect.provideContext(context));

	const deliver = Effect.fnUntraced(function* ({ message, applied, live }: Delivery<Message>) {
		const exit = yield* Effect.exit(
			Effect.flatMap(SubscriptionRef.get(model), (current) =>
				apply(program.update(current, message))
			).pipe(Effect.when(live), Effect.asVoid)
		);
		yield* Deferred.done(applied, exit);
	});

	yield* apply(start);
	yield* Scope.provide(
		Effect.acquireRelease(
			Effect.forkDetach(Stream.runForEach(Stream.fromQueue(deliveries), deliver)),
			(applying) => Effect.andThen(Queue.end(deliveries), Fiber.await(applying))
		),
		scope
	);

	return {
		dispatch: sender(Effect.succeed(true)),
		model: SubscriptionRef.get(model),
		changes: SubscriptionRef.changes(model)
	};
});
