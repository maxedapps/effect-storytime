/**
 * Canonical JSON: a value's Schema JSON encoding with object keys sorted. It is the identity of
 * commands in Loop and Story and the text of every value in story lines and records.
 */
import { Array as Arr, Option, Order, Predicate, Result, Schema } from 'effect';
const isArray = (json) => Array.isArray(json);
const isObject = (json) => Predicate.isObject(json);
const sorted = (json) => isArray(json)
    ? json.map(sorted)
    : isObject(json)
        ? Object.fromEntries(Arr.sortWith(Object.entries(json), ([key]) => key, Order.String).map(([key, value]) => [
            key,
            sorted(value)
        ]))
        : json;
/**
 * Encodes values of `schema` to sorted JSON. Checks such as `Int` are skipped: validity is checked
 * on its own, and an invalid value still needs a key and a story line.
 */
const encoder = (schema) => {
    const encode = Schema.encodeResult(Schema.toCodecJson(schema), { disableChecks: true });
    return (value) => Result.map(encode(value), sorted);
};
/** Encodes values of `schema` to one canonical JSON line, or why a value is not JSON. */
export const canonical = (schema) => {
    const encode = encoder(schema);
    return (value) => Result.map(encode(value), (json) => JSON.stringify(json));
};
/** Encodes values of `schema` to one canonical JSON line. A value that is not JSON throws. */
export const stringifier = (schema) => {
    const encode = canonical(schema);
    return (value) => Result.getOrThrow(encode(value));
};
const tagged = (json) => isObject(json) && Predicate.isString(json['_tag'])
    ? Option.some({
        tag: json['_tag'],
        fields: Object.entries(json).filter(([key]) => key !== '_tag')
    })
    : Option.none();
/** Reads the `_tag` of values of `schema` that have one, such as the cases of a tagged union. */
export const tagger = (schema) => {
    const encode = encoder(schema);
    return (value) => Option.map(Option.flatMap(Result.getSuccess(encode(value)), tagged), ({ tag }) => tag);
};
/** Why a value is not JSON, on one line. */
const reason = (error) => error.message.replaceAll(/\s+/g, ' ');
/** Splits values of `schema` for showing. */
export const shower = (schema) => {
    const encode = encoder(schema);
    return (value) => Result.match(encode(value), {
        onFailure: (error) => ({ notJson: reason(error) }),
        onSuccess: (json) => Option.match(tagged(json), {
            onNone: () => ({ value: json }),
            onSome: ({ tag, fields }) => fields.length === 0 ? { tag } : { tag, value: Object.fromEntries(fields) }
        })
    });
};
/** A shown value as a story line has it: `Tag {fields}`, the tag alone, its JSON, or why it has none. */
export const text = ({ tag, value, notJson }) => notJson === undefined
    ? [
        ...(tag === undefined ? [] : [tag]),
        ...(value === undefined ? [] : [JSON.stringify(value)])
    ].join(' ')
    : `(not JSON: ${notJson})`;
/** Renders a value for a story line, as `text` shows it. */
export const describer = (schema) => {
    const show = shower(schema);
    return (value) => text(show(value));
};
/** The line for a value that is not JSON: the reason, on one line. */
export const notJson = (error) => text({ notJson: reason(error) });
//# sourceMappingURL=canonical.js.map