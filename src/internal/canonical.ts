/**
 * Canonical JSON: a value's Schema JSON encoding with object keys sorted. It is the identity of
 * commands in Loop and Story and the text of every value in story lines and records.
 */
import { Array as Arr, Option, Order, Predicate, Result, Schema } from 'effect';

const isArray = (json: Schema.Json): json is Schema.JsonArray => Array.isArray(json);
const isObject = (json: Schema.Json): json is Schema.JsonObject => Predicate.isObject(json);

const sorted = (json: Schema.Json): Schema.Json =>
	isArray(json)
		? json.map(sorted)
		: isObject(json)
			? Object.fromEntries(
					Arr.sortWith(Object.entries(json), ([key]) => key, Order.String).map(([key, value]) => [
						key,
						sorted(value)
					])
				)
			: json;

/**
 * Encodes values of `schema` to sorted JSON. Checks such as `Int` are skipped: validity is checked
 * on its own, and an invalid value still needs a key and a story line.
 */
const encoder = <A>(schema: Schema.Codec<A, unknown>) => {
	const encode = Schema.encodeResult(Schema.toCodecJson(schema), { disableChecks: true });
	return (value: A) => Result.map(encode(value), sorted);
};

/** Encodes values of `schema` to one canonical JSON line. A value that is not JSON throws. */
export const stringifier = <A>(schema: Schema.Codec<A, unknown>) => {
	const encode = encoder(schema);
	return (value: A): string => JSON.stringify(Result.getOrThrow(encode(value)));
};

const tagged = (json: Schema.Json) =>
	isObject(json) && Predicate.isString(json['_tag'])
		? Option.some({
				tag: json['_tag'],
				fields: Object.entries(json).filter(([key]) => key !== '_tag')
			})
		: Option.none();

/** Reads the `_tag` of values of `schema` that have one, such as the cases of a tagged union. */
export const tagger = <A>(schema: Schema.Codec<A, unknown>) => {
	const encode = encoder(schema);
	return (value: A): Option.Option<string> =>
		Option.map(Option.flatMap(Result.getSuccess(encode(value)), tagged), ({ tag }) => tag);
};

/**
 * Renders a value for a story line: a tagged value as `Tag {fields}`, anything else as JSON, and a
 * value that is not JSON as the reason.
 */
export const describer = <A>(schema: Schema.Codec<A, unknown>) => {
	const encode = encoder(schema);
	return (value: A): string =>
		Result.match(encode(value), {
			onFailure: (error) => `(not JSON: ${error.message.replaceAll(/\s+/g, ' ')})`,
			onSuccess: (json) =>
				Option.match(tagged(json), {
					onNone: () => JSON.stringify(json),
					onSome: ({ tag, fields }) =>
						fields.length === 0 ? tag : `${tag} ${JSON.stringify(Object.fromEntries(fields))}`
				})
		});
};
