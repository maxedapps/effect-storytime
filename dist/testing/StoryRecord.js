/**
 * The story record: every tale a test run told, as deterministic JSON. The reporter writes a
 * `StoryReport`; tools read it back with `decode`.
 */
import { Schema, Struct } from 'effect';
import { StoryFailure } from './Story.js';
/** Where and why a tale failed; for an exploration, also its counterexample and replay token. */
export const Failure = Schema.Struct(Struct.omit(StoryFailure.fields, ['_tag', 'title']));
/**
 * Where a passing story ended in one order of its `anyOrder`s, as a line. The order names the step
 * numbers of their steps as they ran, and is empty without an `anyOrder`.
 */
export const Final = Schema.Struct({
    order: Schema.Array(Schema.Int),
    final: Schema.String
});
export const StoryRecord = Schema.Struct({
    kind: Schema.Literals(['Story', 'Exploration', 'Decision']),
    title: Schema.String,
    /** The test file, posix and relative to the Vitest root. */
    file: Schema.String,
    /** The test's full name, its suites joined by ` > `. */
    test: Schema.String,
    lines: Schema.Array(Schema.String),
    status: Schema.Literals(['passed', 'failed']),
    /** The final state as a line, once a decision passed. */
    final: Schema.optional(Schema.String),
    /** Where a passing story ended, one entry per order. */
    finals: Schema.optional(Schema.Array(Final)),
    /** Present when the tale failed with a `StoryFailure`; another error leaves only the status. */
    failure: Schema.optional(Failure),
    /** The cases a passing story or exploration sent, produced or reached. */
    cases: Schema.optional(Schema.Array(Schema.String))
});
/** A run's records, sorted by file and then test, with no timings or absolute paths. */
export const StoryReport = Schema.Struct({
    version: Schema.Literal(3),
    stories: Schema.Array(StoryRecord)
});
/** Reads a report from the JSON text the reporter wrote. */
export const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(StoryReport));
//# sourceMappingURL=StoryRecord.js.map