/**
 * The protocol every tale implements, so records and the Vitest adapter can run stories,
 * explorations and decisions of any Program or Decider alike.
 */
import type { Effect } from 'effect';
import type { StoryFailure } from '../Story.ts';
import type { Final } from '../StoryRecord.ts';
export declare const TypeId = "~effect-storytime/Tale";
/**
 * What a passing tale reached: a decision's final state or a story's final model per order, as
 * lines, and the cases it touched.
 */
export interface Reached {
    readonly final?: string;
    readonly finals?: ReadonlyArray<Final>;
    readonly cases: ReadonlyArray<string>;
}
export interface Told {
    /** The Program or Decider the tale is about. */
    readonly subject: object;
    readonly lines: ReadonlyArray<string>;
    readonly run: Effect.Effect<Reached, StoryFailure>;
}
export interface Tale {
    readonly _tag: 'Story' | 'Exploration' | 'Decision';
    readonly title: string;
    readonly [TypeId]: () => Told;
}
/**
 * Remembers where `tale` was made: the stack of whoever called `maker`, so its failures point at
 * the test instead of this library.
 */
export declare const made: <T extends Tale>(tale: T, maker: (...args: ReadonlyArray<never>) => Tale) => T;
/** Gives `failure` the stack of the call that made `tale`, so Vitest's code frame shows the tale. */
export declare const located: (tale: Tale, failure: StoryFailure) => StoryFailure;
//# sourceMappingURL=tale.d.ts.map