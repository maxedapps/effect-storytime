/**
 * The strict checks every story, explored path and decision runs, as Effects failing with a
 * Problem that the runner turns into a StoryFailure at the current step.
 */
import { Data, Effect, Result, Schema } from 'effect';
import { canonical, describer } from '../../internal/canonical.js';
export class Problem extends Data.Error {
}
/** Where an explored path broke a rule, before the check knows the replay that reproduces it. */
export class Broken extends Data.Error {
}
/** Runs a user callback; a throw becomes a Problem naming it. */
export const attempt = (name, run) => Effect.try({
    try: run,
    catch: (error) => new Problem({
        message: `${name} threw: ${String(error)}`
    })
});
/** Checks the Type side of `schema`, so codecs such as `BooleanFromBit` take typed values. */
export const conforms = (schema, what) => {
    const decode = Schema.decodeUnknownResult(Schema.toType(schema));
    return (value) => Result.match(decode(value), {
        onSuccess: () => Effect.void,
        onFailure: (error) => Effect.fail(new Problem({ message: `${what} is invalid: ${error.message}` }))
    });
};
/**
 * Gives a value's canonical JSON line, taken each time the Effect runs, so it sees mutations; a
 * value that is not JSON is a Problem.
 */
export const keyed = (schema, what) => {
    const encode = canonical(schema);
    return (value) => Effect.suspend(() => Effect.fromResult(encode(value))).pipe(Effect.mapError((error) => new Problem({ message: `${what} is not JSON: ${error.message}` })));
};
/**
 * Checks that a value survives its JSON text unchanged, and returns the copy decoded from that
 * text, which shares nothing with the value, so a mutation of either never reaches the other.
 */
export const roundTrips = (schema, what) => {
    const text = Schema.fromJsonString(Schema.toCodecJson(schema));
    const encode = Schema.encodeUnknownResult(text);
    const decode = Schema.decodeUnknownResult(text);
    const equivalent = Schema.toEquivalence(Schema.toType(schema));
    const describe = describer(schema);
    return (value) => Effect.fromResult(Result.flatMap(encode(value), decode)).pipe(Effect.mapError((error) => new Problem({ message: `${what} does not survive JSON: ${error.message}` })), Effect.filterOrFail((copy) => equivalent(value, copy), (copy) => new Problem({
        message: `${what} changes through JSON`,
        expected: describe(value),
        actual: describe(copy)
    })));
};
/** Every check on one Schema's values, naming them `what` in each Problem. */
export const role = (schema, what) => ({
    valid: conforms(schema, what),
    key: keyed(schema, what),
    copy: roundTrips(schema, what),
    show: describer(schema)
});
/** Checks every named invariant on a model or state. */
export const holds = (invariants, describe) => (value) => Effect.forEach(Object.entries(invariants), ([name, invariant]) => Effect.flatMap(attempt(`invariant ${name}`, () => invariant(value)), (ok) => ok
    ? Effect.void
    : Effect.fail(new Problem({ message: `invariant ${name} does not hold`, actual: describe(value) })))).pipe(Effect.asVoid);
/**
 * Runs a pure callback twice. Its input's JSON must not change and both results' JSON, each taken
 * right after its run, must agree, which catches mutation and hidden state without freezing.
 */
export const pure = Effect.fnUntraced(function* (name, input, run, output) {
    const before = yield* input;
    const unchanged = Effect.flatMap(input, (after) => after === before
        ? Effect.void
        : Effect.fail(new Problem({ message: `${name} changed its input`, expected: before, actual: after })));
    const first = yield* attempt(name, run);
    const firstText = yield* output(first);
    yield* unchanged;
    const second = yield* attempt(name, run);
    const secondText = yield* output(second);
    yield* unchanged;
    if (firstText !== secondText) {
        return yield* new Problem({
            message: `${name} gave two results for the same input`,
            expected: firstText,
            actual: secondText
        });
    }
    return first;
});
//# sourceMappingURL=check.js.map