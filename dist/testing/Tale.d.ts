/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's or a Decider's tales together touch every one of its cases.
 */
import { Effect, Schema } from 'effect';
import type { Decider } from '../Decider.ts';
import type { Tale } from './internal/tale.ts';
import type { Program, Tagged } from '../Program.ts';
import type { StoryFailure } from './Story.ts';
export type { Reached, Tale } from './internal/tale.ts';
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
export declare const covers: <Model, Message extends Tagged, Command extends Tagged, State, DeciderCommand extends Tagged, Event, Rejection>(subject: Decider<State, DeciderCommand, Event, Rejection, import("../Decider.ts").Handlers<State, DeciderCommand, Event, Rejection>> | Program<Model, Message, Command>, tales: readonly Tale[]) => Effect.Effect<void, StoryFailure | Uncovered, never>;
//# sourceMappingURL=Tale.d.ts.map