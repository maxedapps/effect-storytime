/**
 * Canonical JSON: a value's Schema JSON encoding with object keys sorted. It is the identity of
 * commands in Loop and Story and the text of every value in story lines and records.
 */
import { Option, Result, Schema } from 'effect';
/** Encodes values of `schema` to one canonical JSON line, or why a value is not JSON. */
export declare const canonical: <A>(schema: Schema.Codec<A, unknown>) => (value: A) => Result.Result<string, Schema.SchemaError>;
/** Encodes values of `schema` to one canonical JSON line. A value that is not JSON throws. */
export declare const stringifier: <A>(schema: Schema.Codec<A, unknown>) => (value: A) => string;
/** Reads the `_tag` of values of `schema` that have one, such as the cases of a tagged union. */
export declare const tagger: <A>(schema: Schema.Codec<A, unknown>) => (value: A) => Option.Option<string>;
/**
 * Renders a value for a story line: a tagged value as `Tag {fields}`, anything else as JSON, and a
 * value that is not JSON as the reason.
 */
export declare const describer: <A>(schema: Schema.Codec<A, unknown>) => (value: A) => string;
//# sourceMappingURL=canonical.d.ts.map