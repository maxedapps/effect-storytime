/**
 * Canonical JSON: a value's Schema JSON encoding with object keys sorted. It is the identity of
 * commands in Loop and Story and the text of every value in a story record.
 */
import { Array as Arr, Effect, Order, Predicate, Schema } from 'effect';

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

/** Encodes values of `schema` as canonical JSON; values that do not encode are defects. */
export const encoder = <A>(schema: Schema.Codec<A, unknown>) => {
	const encode = Schema.encodeEffect(Schema.toCodecJson(schema));
	return (value: A): Effect.Effect<string> =>
		encode(value).pipe(
			Effect.map((json) => JSON.stringify(sorted(json))),
			Effect.orDie
		);
};
