/**
 * A Loop runs a Program: one fiber applies messages in order, commands run as fibers keyed by
 * their canonical JSON, and an optional store keeps the model across restarts. Command fibers
 * only enqueue their messages, so a command its own message cancels or replaces never cuts an
 * apply short, and a message from a command cancelled or replaced since it was enqueued is dropped.
 */
import { Cause, Deferred, Effect, Fiber, FiberMap, Option, Queue, Scope, Stream, SubscriptionRef } from 'effect';
import { describer, stringifier } from './internal/canonical.js';
import { enforce } from './internal/invariants.js';
/**
 * Starts a Loop in the current scope. A stored model is resumed, otherwise `init` applies. Each
 * model must satisfy the Program's invariants before it is saved, published or its commands
 * start; one that breaks them dies with `Program.InvariantBroken` and changes nothing. Each
 * model is saved before its commands start. Closing the scope applies the messages already
 * dispatched, then interrupts every command.
 */
export const make = Effect.fnUntraced(function* (program, options) {
    const context = yield* Effect.context();
    const keyOf = stringifier(program.Command);
    const stored = options.persist ? yield* options.persist.load : Option.none();
    const start = Option.match(stored, { onNone: () => options.init, onSome: program.resume });
    const model = yield* SubscriptionRef.make(start.model);
    // The Loop's own scope releases in order whatever the caller's strategy: the deliveries drain
    // before the FiberMap interrupts the commands they started.
    const scope = yield* Scope.fork(yield* Effect.scope, 'sequential');
    const fibers = yield* Scope.provide(FiberMap.make(), scope);
    const holds = enforce(program.invariants, describer(program.Model));
    const deliveries = yield* Queue.unbounded();
    const sender = (live) => Effect.fnUntraced(function* (message) {
        const applied = yield* Deferred.make();
        const open = yield* Queue.offer(deliveries, { message, applied, live });
        return yield* open ? Deferred.await(applied) : Effect.interrupt;
    });
    const run = (command, key) => Effect.withFiber((fiber) => {
        const send = sender(Effect.map(FiberMap.get(fibers, key), Option.exists((running) => running === fiber)));
        const output = options.handler(command);
        return Stream.isStream(output)
            ? Stream.runForEach(output, send)
            : Effect.flatMap(output, (message) => message === undefined ? Effect.void : send(message));
    });
    const apply = Effect.fnUntraced(function* (next) {
        yield* holds(next.model);
        if (options.persist)
            yield* options.persist.save(next.model);
        yield* SubscriptionRef.set(model, next.model);
        for (const command of next.cancels ?? [])
            yield* FiberMap.remove(fibers, keyOf(command));
        for (const command of next.commands ?? []) {
            const key = keyOf(command);
            yield* FiberMap.run(fibers, key, run(command, key));
        }
    }, Effect.provideContext(context));
    const deliver = Effect.fnUntraced(function* ({ message, applied, live }) {
        const exit = yield* Effect.exit(Effect.flatMap(SubscriptionRef.get(model), (current) => apply(program.update(current, message))).pipe(Effect.when(live), Effect.asVoid));
        yield* Deferred.done(applied, exit);
    });
    yield* apply(start);
    yield* Scope.provide(Effect.acquireRelease(Effect.forkDetach(Stream.runForEach(Stream.fromQueue(deliveries), deliver)), (applying) => Effect.andThen(Queue.end(deliveries), Fiber.await(applying))), scope);
    return {
        dispatch: sender(Effect.succeed(true)),
        model: SubscriptionRef.get(model),
        changes: SubscriptionRef.changes(model),
        join: FiberMap.join(fibers)
    };
});
//# sourceMappingURL=Loop.js.map