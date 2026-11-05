/**
 * The strict checks every story, explored path and decision runs, as Effects failing with a
 * Problem that the runner turns into a StoryFailure at the current step.
 */
import { Data, Effect, Schema } from 'effect';
import type { Invariants } from '../Program.ts';
export declare class Problem extends Data.Error<{
    readonly message: string;
    readonly expected?: string;
    readonly actual?: string;
}> {
}
/** Where an explored path broke a rule, before the check knows the replay that reproduces it. */
export declare class Broken extends Data.Error<{
    readonly step: number;
    readonly problem: Problem;
    readonly counterexample: ReadonlyArray<string>;
}> {
}
/** Runs a user callback; a throw becomes a Problem naming it. */
export declare const attempt: <A>(name: string, run: () => A) => Effect.Effect<A, Problem, never>;
/** Checks the Type side of `schema`, so codecs such as `BooleanFromBit` take typed values. */
export declare const conforms: <A>(schema: Schema.Codec<A, unknown>, what: string) => (value: A) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
/**
 * Gives a value's canonical JSON line, taken each time the Effect runs, so it sees mutations; a
 * value that is not JSON is a Problem.
 */
export declare const keyed: <A>(schema: Schema.Codec<A, unknown>, what: string) => (value: A) => Effect.Effect<string, Problem, never>;
/**
 * Checks that a value survives its JSON text unchanged, and returns the copy decoded from that
 * text, which shares nothing with the value, so a mutation of either never reaches the other.
 */
export declare const roundTrips: <A>(schema: Schema.Codec<A, unknown>, what: string) => (value: A) => Effect.Effect<A, Problem, never>;
/** Every check on one Schema's values, naming them `what` in each Problem. */
export declare const role: <A>(schema: Schema.Codec<A, unknown>, what: string) => {
    valid: (value: A) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
    key: (value: A) => Effect.Effect<string, Problem, never>;
    copy: (value: A) => Effect.Effect<A, Problem, never>;
    show: (value: A) => string;
};
/** Checks every named invariant on a model or state. */
export declare const holds: <A>(invariants: Invariants<A>, describe: (value: A) => string) => (value: A) => Effect.Effect<void, Problem, never>;
/**
 * Runs a pure callback twice. Its input's JSON must not change and both results' JSON, each taken
 * right after its run, must agree, which catches mutation and hidden state without freezing.
 */
export declare const pure: <A>(name: string, input: Effect.Effect<string, Problem, never>, run: () => A, output: (result: A) => Effect.Effect<string, Problem>) => Effect.Effect<A, Problem, never>;
//# sourceMappingURL=check.d.ts.map