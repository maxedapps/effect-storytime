/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's or a Decider's tales together touch every one of its cases, and
 * `breaks` that each of its invariants can fail.
 */
import { Effect, Schema } from 'effect';
import type { Decider } from '../Decider.ts';
import type { Step } from './internal/steps.ts';
import type { Tale } from './internal/tale.ts';
import type { Invariants, Program, Tagged } from '../Program.ts';
import type { StoryFailure } from './Story.ts';
export type { Reached, Tale } from './internal/tale.ts';
/** Any tale's steps as data: what records keep and Markdown pages show. */
export declare const steps: (tale: Tale) => ReadonlyArray<Step>;
/** Renders any tale as its plain lines. */
export declare const lines: (tale: Tale) => ReadonlyArray<string>;
/** Runs any tale in memory. */
export declare const run: (tale: Tale) => Effect.Effect<import("./Tale.ts").Reached, StoryFailure, never>;
/**
 * Every case a Program or a Decider has, from each of its Schemas that is a tagged union: a
 * Program's Models, Messages and Commands, a Decider's States, Commands, Events and Rejections.
 */
export declare const cases: <Model, Message extends Tagged, Command extends Tagged, State, DeciderCommand extends Tagged, Event, Rejection>(subject: Program<Model, Message, Command> | Decider<State, DeciderCommand, Event, Rejection>) => ReadonlyArray<string>;
declare const Uncovered_base: Schema.Class<Uncovered, Schema.TaggedStruct<"Uncovered", {
    readonly missing: Schema.$Array<Schema.String>;
}>, import("effect/Cause").YieldableError>;
/** The cases of a Program or Decider that none of its tales touched. */
export declare class Uncovered extends Uncovered_base {
    get message(): string;
}
/**
 * Runs a Program's stories and explorations, or a Decider's decisions and explorations, and
 * requires them to touch every case it has between them. Tales of another subject don't count.
 */
export declare const covers: <Model, Message extends Tagged, Command extends Tagged, State, DeciderCommand extends Tagged, Event, Rejection>(subject: Decider<State, DeciderCommand, Event, Rejection, import("../Decider.ts").Handlers<State, DeciderCommand, Event, Rejection>, string> | Program<Model, Message, Command, string>, tales: readonly Tale[]) => Effect.Effect<void, StoryFailure | Uncovered, never>;
/** A Program or a Decider as `breaks` sees it: its invariants and the Schema of what they judge. */
export type Judged<Value, Name extends string> = {
    readonly invariants: Invariants<Value, Name>;
} & ({
    readonly Model: Schema.Codec<Value, unknown>;
} | {
    readonly State: Schema.Codec<Value, unknown>;
});
/** For each invariant a model or state that breaks it, keyed by the invariant's name. */
export type Breaking<Value, Name extends string> = {
    readonly [Invariant in Name]: Value;
};
declare const Unbroken_base: Schema.Class<Unbroken, Schema.TaggedStruct<"Unbroken", {
    readonly invariant: Schema.String;
    readonly problem: Schema.String;
    readonly actual: Schema.optional<Schema.String>;
}>, import("effect/Cause").YieldableError>;
/** An invariant whose given model or state does not break it alone. */
export declare class Unbroken extends Unbroken_base {
    get message(): string;
}
/**
 * Proves that each invariant of a Program or a Decider can fail: the model or state given for it
 * must be valid, survive JSON, and break that invariant and no other. An invariant that can never
 * be false passes every tale unnoticed, and one that only breaks with another adds nothing.
 */
export declare const breaks: <Value, Name extends string>(subject: Judged<Value, Name>, states: Breaking<NoInfer<Value>, NoInfer<Name>>) => Effect.Effect<void, Unbroken, never>;
//# sourceMappingURL=Tale.d.ts.map