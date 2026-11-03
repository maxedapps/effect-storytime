/**
 * A Program is a pure state machine: `update` turns a model and a message into the next model
 * and the commands to run. Commands are Schema data; a Loop runs them, a story asserts them.
 */
import type { Schema } from 'effect';
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
/** Named predicates every model must satisfy, checked after each step of every story. */
export type Invariants<Model> = Readonly<Record<string, (model: Model) => boolean>>;
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
