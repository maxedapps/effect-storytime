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
 * A value split for showing: its `_tag`, its canonical JSON without the tag (absent for a tag
 * alone), or why it has no JSON.
 */
export interface Shown {
    readonly tag?: string;
    readonly value?: Schema.Json;
    readonly notJson?: string;
}
/** Splits values of `schema` for showing. */
export declare const shower: <A>(schema: Schema.Codec<A, unknown>) => (value: A) => Shown;
/** A shown value as a story line has it: `Tag {fields}`, the tag alone, its JSON, or why it has none. */
export declare const text: ({ tag, value, notJson }: Shown) => string;
/** Renders a value for a story line, as `text` shows it. */
export declare const describer: <A>(schema: Schema.Codec<A, unknown>) => (value: A) => string;
/** The line for a value that is not JSON: the reason, on one line. */
export declare const notJson: (error: Schema.SchemaError) => string;
//# sourceMappingURL=canonical.d.ts.map