import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { encoder } from '../src/internal/canonical.ts';

const Pages = Schema.Struct({
	pages: Schema.Array(Schema.Record(Schema.String, Schema.FiniteFromString)),
	at: Schema.Date
});

describe('canonical JSON', () => {
	it.effect('encodes through the Schema with every object key sorted', () =>
		Effect.gen(function* () {
			const encode = encoder(Pages);
			const at = new Date('2026-11-03T00:00:00.000Z');
			const json = '{"at":"2026-11-03T00:00:00.000Z","pages":[{"a":"1","b":"2","c":"3"},{}]}';
			expect(yield* encode({ pages: [{ c: 3, a: 1, b: 2 }, {}], at })).toBe(json);
			expect(yield* encode({ at, pages: [{ b: 2, c: 3, a: 1 }, {}] })).toBe(json);
		})
	);
});
