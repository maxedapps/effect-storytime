/**
 * The protocol every tale implements, so records and the Vitest adapter can run stories,
 * explorations and decisions of any Program or Decider alike.
 */
import type { Effect } from 'effect';
import type { StoryFailure } from '../Story.ts';
export declare const TypeId = "~effect-storytime/Tale";
/** What a passing tale reached: its final model or state as a line, and the cases it touched. */
export interface Reached {
    readonly final?: string;
    readonly cases?: ReadonlyArray<string>;
}
export interface Told {
    readonly lines: ReadonlyArray<string>;
    readonly run: Effect.Effect<Reached, StoryFailure>;
}
export interface Tale {
    readonly _tag: 'Story' | 'Exploration' | 'Decision';
    readonly title: string;
    readonly [TypeId]: () => Told;
}
