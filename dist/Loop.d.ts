/**
 * A Loop runs a Program: one fiber applies messages in order, and the app's handler runs the
 * commands. A write runs inside its transition, in the store's transaction with the model; any
 * other command runs as a fiber keyed by its canonical JSON and feeds its messages back. Command
 * fibers only enqueue their messages, so a command its own message cancels or replaces never cuts
 * an apply short, and a message from a command cancelled or replaced since it was enqueued is
 * dropped.
 */
import { Effect, Option, Scope, Stream } from 'effect';
import type { Next, Program, Tagged } from './Program.ts';
/** A command's effect that belongs to its transition, made with `write`. */
export declare class Write<E, R> {
    readonly effect: Effect.Effect<void, E, R>;
    constructor(effect: Effect.Effect<void, E, R>);
}
/**
 * Makes a command's effect part of its transition: it runs in the order `update` listed it,
 * inside the store's transaction with the model, before the model is published or any other
 * command starts. Use it for what must commit or roll back with the model: events into a log, an
 * outbox row, an alarm.
 */
export declare const write: <E = never, R = never>(effect: Effect.Effect<void, E, R>) => Write<E, R>;
/** What a handler runs as a fiber: an Effect that may answer with a message, or a Stream of them. */
export type Work<Message, E, R> = Effect.Effect<Message | void, E, R> | Stream.Stream<Message, E, R>;
/**
 * Runs a command: a write, or work that answers with messages. Map a failure the Program should
 * decide on to a message; any other failure fails the command, and with it `join`, `settled` and
 * `run`. Write it with the Command union's exhaustive `match`, so a new command without a handler
 * does not compile.
 */
export type Handler<Message, Command, E, R> = (command: Command) => Work<Message, E, R> | Write<E, R>;
/**
 * Where the model lives across restarts: `load` gives back exactly what `save` stored, and
 * `transaction` commits a save together with its transition's writes, or neither.
 */
export interface Store<Model, E, R> {
    readonly load: Effect.Effect<Option.Option<Model>, E, R>;
    readonly save: (model: Model) => Effect.Effect<void, E, R>;
    readonly transaction: <A, E2, R2>(effect: Effect.Effect<A, E2, R2>) => Effect.Effect<A, E | E2, R | R2>;
}
export interface Options<Model, Message, Command extends Tagged, E, R> {
    /** The start when nothing is stored. */
    readonly init: Next<Model, Command>;
    readonly handler: Handler<Message, Command, E, R>;
    readonly store?: Store<Model, E, R>;
}
export interface RunOptions<Model, Message, Command extends Tagged, E, R> extends Options<Model, Message, Command, E, R> {
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
/**
 * Starts a Loop in the current scope. In one transaction of the store, it loads the stored model
 * and resumes it, otherwise `init` applies. Every transition then checks the Program's invariants
 * on its model, saves it and runs its writes, in one transaction, before it publishes the model
 * and starts the rest of its commands. A model that breaks an invariant dies with
 * `Program.InvariantBroken`, and a failing save or write fails the transition; either changes
 * nothing. Closing the scope applies the messages already dispatched, then interrupts every
 * command.
 */
export declare const make: <Model, Message extends Tagged, Command extends Tagged, E = never, R = never>(program: Program<Model, Message, Command>, options: Options<Model, Message, Command, E, R>) => Effect.Effect<Loop<Model, Message, E>, E, R | Scope.Scope>;
/**
 * Runs a Program to the end in a scope of its own: starts a Loop, dispatches `messages` in order
 * and gives the model once no command runs, traced as the span `Loop.run`. Fails with the first
 * failure of a dispatch or a command, which dispatches nothing more and interrupts the commands
 * still running.
 */
export declare const run: <Model, Message extends Tagged, Command extends Tagged, E = never, R = never>(program: Program<Model, Message, Command>, options: RunOptions<Model, Message, Command, E, R>) => Effect.Effect<Model, E, Exclude<R, Scope.Scope>>;
//# sourceMappingURL=Loop.d.ts.map