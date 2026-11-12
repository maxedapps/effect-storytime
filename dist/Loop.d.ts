/**
 * A Loop runs a Program: one fiber applies messages in order, commands run as fibers keyed by
 * their canonical JSON, and an optional store keeps the model across restarts. Command fibers
 * only enqueue their messages, so a command its own message cancels or replaces never cuts an
 * apply short, and a message from a command cancelled or replaced since it was enqueued is dropped.
 */
import { Effect, Option, Scope, Stream } from 'effect';
import type { Next, Program, Tagged } from './Program.ts';
/**
 * Runs a command: an Effect that may answer with a message, or a Stream of them. Failures must
 * become messages, so the Program decides what they mean. Write it with the Command union's
 * exhaustive `match`, so a new command without a handler does not compile.
 */
export type Handler<Message, Command, R> = (command: Command) => Effect.Effect<Message | void, never, R> | Stream.Stream<Message, never, R>;
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
    /** Applies a message and starts its commands; completes once the model is updated. */
    readonly dispatch: (message: Message) => Effect.Effect<void>;
    readonly model: Effect.Effect<Model>;
    readonly changes: Stream.Stream<Model>;
}
/**
 * Starts a Loop in the current scope. A stored model is resumed, otherwise `init` applies. Each
 * model is saved before its commands start; closing the scope interrupts every command.
 */
export declare const make: <Model, Message extends Tagged, Command extends Tagged, R = never>(program: Program<Model, Message, Command>, options: Options<Model, Message, Command, R>) => Effect.Effect<Loop<Model, Message>, never, R | Scope.Scope>;
//# sourceMappingURL=Loop.d.ts.map