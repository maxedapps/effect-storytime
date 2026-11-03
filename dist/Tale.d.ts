/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's tales together touch every one of its cases.
 */
import { Effect, Schema } from 'effect';
import * as Exploration from './Exploration.ts';
import type { Tale } from './internal/tale.ts';
import type { Program, Tagged } from './Program.ts';
import * as Story from './Story.ts';
export type { Reached, Tale } from './internal/tale.ts';
/** Renders any tale as its plain lines. */
export declare const lines: (tale: Tale) => ReadonlyArray<string>;
/** Runs any tale in memory. */
export declare const run: (tale: Tale) => Effect.Effect<import("./Tale.ts").Reached, Story.StoryFailure, never>;
/** Every case a Program has: its Messages, its Commands and, for a tagged union, its Models. */
export declare const cases: <Model, Message extends Tagged, Command extends Tagged>(program: Program<Model, Message, Command>) => ReadonlyArray<string>;
declare const Uncovered_base: Schema.Class<Uncovered, Schema.TaggedStruct<"Uncovered", {
    readonly missing: Schema.$Array<Schema.String>;
}>, import("effect/Cause").YieldableError>;
/** The cases of a Program that none of its tales touched. */
export declare class Uncovered extends Uncovered_base {
    get message(): string;
}
/**
 * Runs a Program's stories and explorations and requires them to send, produce or reach every
 * case it has between them.
 */
export declare const covers: <Model, Message extends Tagged, Command extends Tagged>(program: Program<Model, Message, Command>, tales: readonly (Exploration.Exploration<Model, Message, Command> | Story.Story<Model, Message, Command>)[]) => Effect.Effect<void, Story.StoryFailure | Uncovered, never>;
