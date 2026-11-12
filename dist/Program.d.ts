/**
 * A Program is a pure state machine: `update` turns a model and a message into the next model
 * and the commands to run. Commands are Schema data; a Loop runs them, a story asserts them.
 */
import { Schema } from 'effect';
/** A value with a `_tag`, such as a case of `Schema.TaggedUnion`. */
export interface Tagged {
    readonly _tag: string;
}
/** A Schema of tagged values that lists its cases, such as `Schema.TaggedUnion`. */
export interface Cases<A extends Tagged> extends Schema.Codec<A, unknown> {
    readonly cases: Readonly<Record<string, Schema.Constraint>>;
}
/** What `update` and `resume` return: the next model, the commands to start and those to stop. */
export interface Next<Model, Command> {
    readonly model: Model;
    readonly commands?: ReadonlyArray<Command>;
    readonly cancels?: ReadonlyArray<Command>;
}
/**
 * Named predicates every model or state must satisfy. A Loop checks a Program's on every model
 * before it keeps it, `Decider.handle` a Decider's on the state each command reaches, and every
 * tale checks them at each step.
 */
export type Invariants<Model> = Readonly<Record<string, (model: Model) => boolean>>;
declare const InvariantBroken_base: Schema.Class<InvariantBroken, Schema.TaggedStruct<"InvariantBroken", {
    readonly invariant: Schema.String;
    /** The model or state as a line, as stories show it. */
    readonly state: Schema.String;
}>, import("effect/Cause").YieldableError>;
/**
 * The defect a Loop or `Decider.handle` dies with when a model or state breaks an invariant. It
 * dies before anything is saved, published or started.
 */
export declare class InvariantBroken extends InvariantBroken_base {
    get message(): string;
}
export interface Program<Model, Message extends Tagged, Command extends Tagged> {
    readonly Model: Schema.Codec<Model, unknown>;
    readonly Message: Cases<Message>;
    readonly Command: Cases<Command>;
    readonly update: (model: Model, message: Message) => Next<Model, Command>;
    /** What to redo after a restart, from the stored model alone. */
    readonly resume: (model: Model) => Next<Model, Command>;
    readonly invariants: Invariants<Model>;
}
export interface Definition<Model, Message extends Tagged, Command extends Tagged> {
    readonly Model: Schema.Codec<Model, unknown>;
    readonly Message: Cases<Message>;
    readonly Command: Cases<Command>;
    readonly update: (model: Model, message: Message) => Next<Model, Command>;
    readonly resume?: (model: Model) => Next<Model, Command>;
    readonly invariants?: Invariants<Model>;
}
export declare const make: <Model, Message extends Tagged, Command extends Tagged>(definition: Definition<Model, Message, Command>) => Program<Model, Message, Command>;
export {};
//# sourceMappingURL=Program.d.ts.map