/**
 * A Loop runs a Program: one fiber applies messages in order, commands run as fibers keyed by
 * their canonical JSON, and an optional store keeps the model across restarts. Command fibers
 * only enqueue their messages, so a command its own message cancels or replaces never cuts an
 * apply short, and a message from a command cancelled or replaced since it was enqueued is dropped.
 */
import { Deferred, Effect, FiberMap, Option, Queue, Scope, Stream, SubscriptionRef } from 'effect';
import { stringifier } from './internal/canonical.js';
/**
 * Starts a Loop in the current scope. A stored model is resumed, otherwise `init` applies. Each
 * model is saved before its commands start; closing the scope interrupts every command.
 */
export const make = Effect.fnUntraced(function* (program, options) {
    const context = yield* Effect.context();
    const keyOf = stringifier(program.Command);
    const stored = options.persist ? yield* options.persist.load : Option.none();
    const start = Option.match(stored, { onNone: () => options.init, onSome: program.resume });
    const model = yield* SubscriptionRef.make(start.model);
    const fibers = yield* FiberMap.make();
    const deliveries = yield* Queue.unbounded();
    const sender = (live) => (message) => Effect.gen(function* () {
        const applied = yield* Deferred.make();
        yield* Queue.offer(deliveries, { message, applied, live });
        yield* Deferred.await(applied);
    });
    const run = (command, key) => Effect.withFiber((fiber) => {
        const send = sender(Effect.map(FiberMap.get(fibers, key), Option.exists((running) => running === fiber)));
        const output = options.handler(command);
        return Stream.isStream(output)
            ? Stream.runForEach(output, send)
            : Effect.flatMap(output, (message) => message === undefined ? Effect.void : send(message));
    });
    const apply = Effect.fnUntraced(function* (next) {
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
    yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(deliveries), deliver)));
    return {
        dispatch: sender(Effect.succeed(true)),
        model: SubscriptionRef.get(model),
        changes: SubscriptionRef.changes(model)
    };
});
//# sourceMappingURL=Loop.js.map