/**
 * A story tells how a Program behaves, as steps: start from a model, send messages, and account
 * for every command it asks for. Running it checks each step and the strict rules in between.
 */
import { Data, Effect, Option, Schema } from 'effect';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import type { Program, Tagged } from '../Program.ts';
export type Step<Model, Message, Command> = Data.TaggedEnum<{
    Given: {
        readonly model: Model;
    };
    Send: {
        readonly message: Message;
    };
    Model: {
        readonly expected: Model;
    };
    Satisfies: {
        readonly label: string;
        readonly check: (model: Model) => boolean;
    };
    Commands: {
        readonly commands: ReadonlyArray<Command>;
    };
    Resolve: {
        readonly command: Command;
        readonly reply: Option.Option<Message>;
    };
    Emit: {
        readonly command: Command;
        readonly message: Message;
    };
    Restart: {};
    AnyOrder: {
        readonly steps: Steps<Model, Message, Command>;
    };
    Group: {
        readonly steps: Steps<Model, Message, Command>;
    };
}>;
export type Steps<Model, Message, Command> = ReadonlyArray<Step<Model, Message, Command>>;
/** Starts the story from a model. It comes first and only once. */
export declare const given: <Model = never, Message = never, Command = never>(model: NoInfer<Model>) => Step<Model, Message, Command>;
/** Sends a message through `update`. */
export declare const send: <Model = never, Message = never, Command = never>(message: NoInfer<Message>) => Step<Model, Message, Command>;
/** Requires the model to equal `expected`. */
export declare const model: <Model = never, Message = never, Command = never>(expected: NoInfer<Model>) => Step<Model, Message, Command>;
/** Requires the model to pass a check, shown in story lines by its label. */
export declare const satisfies: <Model = never, Message = never, Command = never>(label: string, check: (model: NoInfer<Model>) => boolean) => Step<Model, Message, Command>;
/** Requires exactly these commands to be pending, in any order; `commands()` means none. */
export declare const commands: <Model = never, Message = never, Command = never>(...expected: ReadonlyArray<NoInfer<Command>>) => Step<Model, Message, Command>;
/** Completes a pending command and feeds its reply, if it has one, through `update`. */
export declare const resolve: <Model = never, Message = never, Command = never>(command: NoInfer<Command>, reply?: NoInfer<Message>) => Step<Model, Message, Command>;
/** Feeds one message from a pending streaming command, which stays pending. */
export declare const emit: <Model = never, Message = never, Command = never>(command: NoInfer<Command>, message: NoInfer<Message>) => Step<Model, Message, Command>;
/**
 * Restarts as after a crash: the model goes through JSON, every pending command is dropped and
 * `resume` decides what to redo.
 */
export declare const restart: <Model = never, Message = never, Command = never>() => Step<Model, Message, Command>;
/**
 * Runs the rest of the story once per order of these 2 to 5 steps. A `resolve` or `emit` is
 * skipped when its command was cancelled earlier in the same order.
 */
export declare const anyOrder: <Model = never, Message = never, Command = never>(...steps: Steps<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>) => Step<Model, Message, Command>;
/** Groups steps, so a story can share a common part. */
export declare const steps: <Model = never, Message = never, Command = never>(...grouped: Steps<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>) => Step<Model, Message, Command>;
declare const Story_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Readonly<A> & {
    readonly _tag: "Story";
} & import("effect/Pipeable").Pipeable;
export declare class Story<Model, Message extends Tagged, Command extends Tagged> extends Story_base<{
    readonly title: string;
    readonly program: Program<Model, Message, Command>;
    readonly steps: Steps<Model, Message, Command>;
}> {
    [TypeId](): Told;
}
export declare const make: <Model, Message extends Tagged, Command extends Tagged>(title: string, program: Program<Model, Message, Command>, ...body: Steps<Model, Message, Command>) => Story<Model, Message, Command>;
declare const StoryFailure_base: Schema.Class<StoryFailure, Schema.TaggedStruct<"StoryFailure", {
    readonly title: Schema.String;
    readonly step: Schema.Int;
    readonly line: Schema.String;
    readonly message: Schema.String;
    readonly expected: Schema.optional<Schema.String>;
    readonly actual: Schema.optional<Schema.String>;
    readonly counterexample: Schema.optional<Schema.$Array<Schema.String>>;
    readonly replay: Schema.optional<Schema.String>;
}>, import("effect/Cause").YieldableError>;
/** A failed story, with the step (its line number in `lines`) where it failed. */
export declare class StoryFailure extends StoryFailure_base {
}
/**
 * What a passing story reached: its final model, also as a line, and the cases it sent, produced
 * or reached.
 */
export interface Outcome<Model> {
    readonly model: Model;
    readonly final: string;
    readonly cases: ReadonlyArray<string>;
}
/** Renders a story as plain lines, from its value alone. */
export declare const lines: <Model, Message extends Tagged, Command extends Tagged>(story: Story<Model, Message, Command>) => ReadonlyArray<string>;
/** Runs a story: every step and every strict rule, once per order of each `anyOrder`. */
export declare const run: <Model, Message extends Tagged, Command extends Tagged>(story: Story<Model, Message, Command>) => Effect.Effect<Outcome<Model>, StoryFailure, never>;
export {};
//# sourceMappingURL=Story.d.ts.map