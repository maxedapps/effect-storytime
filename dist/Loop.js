/**
 * A Loop runs a Program: one fiber applies messages in order, and the app's handler runs the
 * commands. A write runs inside its transition, in the store's transaction with the model; any
 * other command runs as a fiber keyed by its canonical JSON and feeds its messages back. Command
 * fibers only enqueue their messages, so a command its own message cancels or replaces never cuts
 * an apply short, and a message from a command cancelled or replaced since it was enqueued is
 * dropped.
 */
import { Cause, Deferred, Effect, Fiber, FiberMap, Option, Queue, Scope, Stream, SubscriptionRef } from 'effect';
import { stringifier } from './internal/canonical.js';
import { enforce } from './internal/invariants.js';
/** A command's effect that belongs to its transition, made with `write`. */
export class Write {
    effect;
    constructor(effect) {
        this.effect = effect;
    }
}
/**
 * Makes a command's effect part of its transition: it runs in the order `update` listed it,
 * inside the store's transaction with the model, before the model is published or any other
 * command starts. Use it for what must commit or roll back with the model: events into a log, an
 * outbox row, an alarm.
 */
export const write = (effect) => new Write(effect);
/**
 * Starts a Loop in the current scope. In one transaction of the store, it loads the stored model
 * and resumes it, otherwise `init` applies. Every transition then checks the Program's invariants
 * on its model, saves it and runs its writes, in one transaction, before it publishes the model
 * and starts the rest of its commands. A model that breaks an invariant dies with
 * `Program.InvariantBroken`, and a failing save or write fails the transition; either changes
 * nothing. Closing the scope applies the messages already dispatched, then interrupts every
 * command.
 */
export const make = Effect.fnUntraced(function* (program, options) {
    const { handler, store } = options;
    const context = yield* Effect.context();
    const keyOf = stringifier(program.Command);
    const holds = enforce(program.invariants, program.Model);
    const transaction = store
        ? store.transaction
        : (effect) => effect;
    // The Loop's own scope releases in order whatever the caller's strategy: the deliveries drain
    // before the FiberMap interrupts the commands they started.
    const scope = yield* Scope.fork(yield* Effect.scope, 'sequential');
    const fibers = yield* Scope.provide(FiberMap.make(), scope);
    const deliveries = yield* Queue.unbounded();
    const commit = Effect.fnUntraced(function* (next) {
        yield* holds(next.model);
        if (store)
            yield* store.save(next.model);
        // Identical commands are one, as in a story: each runs once, where it first appears.
        const commands = new Map((next.commands ?? []).map((command) => [keyOf(command), command]));
        const work = new Map();
        for (const [key, command] of commands) {
            const output = handler(command);
            if (output instanceof Write)
                yield* output.effect;
            else
                work.set(key, output);
        }
        return { next, work };
    });
    const first = yield* transaction(Effect.flatMap(store ? store.load : Effect.succeedNone, (stored) => commit(Option.match(stored, { onNone: () => options.init, onSome: program.resume }))));
    const model = yield* SubscriptionRef.make(first.next.model);
    const sender = (live) => Effect.fnUntraced(function* (message) {
        const applied = yield* Deferred.make();
        const open = yield* Queue.offer(deliveries, { message, applied, live });
        return yield* open ? Deferred.await(applied) : Effect.interrupt;
    });
    const run = (work, key) => Effect.withFiber((fiber) => {
        const send = sender(Effect.map(FiberMap.get(fibers, key), Option.exists((running) => running === fiber)));
        return Stream.isStream(work)
            ? Stream.runForEach(work, send)
            : Effect.flatMap(work, (message) => (message === undefined ? Effect.void : send(message)));
    });
    const enact = Effect.fnUntraced(function* ({ next, work }) {
        yield* SubscriptionRef.set(model, next.model);
        // The new commands start before the cancelled ones stop, so the map empties only once the
        // process is idle, even when a reply cancels its own command. A key both cancelled and
        // started is replaced by its new fiber.
        for (const [key, output] of work)
            yield* FiberMap.run(fibers, key, run(output, key));
        for (const command of next.cancels ?? []) {
            const key = keyOf(command);
            if (!work.has(key))
                yield* FiberMap.remove(fibers, key);
        }
    }, Effect.provideContext(context));
    const deliver = Effect.fnUntraced(function* ({ message, applied, live }) {
        const exit = yield* Effect.exit(transaction(Effect.flatMap(SubscriptionRef.get(model), (current) => commit(program.update(current, message)))).pipe(Effect.provideContext(context), Effect.flatMap(enact), Effect.when(live), Effect.asVoid));
        yield* Deferred.done(applied, exit);
    });
    yield* enact(first);
    yield* Scope.provide(Effect.acquireRelease(Effect.forkDetach(Stream.runForEach(Stream.fromQueue(deliveries), deliver)), (applying) => Effect.andThen(Queue.end(deliveries), Fiber.await(applying))), scope);
    const join = FiberMap.join(fibers);
    return {
        dispatch: sender(Effect.succeed(true)),
        model: SubscriptionRef.get(model),
        changes: SubscriptionRef.changes(model),
        // A failing fiber completes `join` as it leaves the map, so `join` wins the race against
        // `awaitEmpty` whenever a command failed.
        settled: Effect.raceFirst(join, FiberMap.awaitEmpty(fibers)).pipe(Effect.andThen(SubscriptionRef.get(model))),
        join
    };
});
/**
 * Runs a Program to the end in a scope of its own: starts a Loop, dispatches `messages` in order
 * and gives the model once no command runs, traced as the span `Loop.run`. Fails with the first
 * failure of a dispatch or a command, which dispatches nothing more and interrupts the commands
 * still running.
 */
export const run = Effect.fn('Loop.run')(function* (program, options) {
    const loop = yield* make(program, options);
    // `join` succeeds only once this scope closes, so here it ends only with the first failure,
    // which stops the dispatches still to come.
    return yield* Effect.raceFirst(Effect.andThen(loop.join, Effect.never), Effect.gen(function* () {
        for (const message of options.messages ?? [])
            yield* loop.dispatch(message);
        return yield* loop.settled;
    }));
}, Effect.scoped);
//# sourceMappingURL=Loop.js.map