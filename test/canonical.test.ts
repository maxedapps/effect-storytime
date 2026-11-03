import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';
import { stringifier } from '../src/internal/canonical.ts';

const Pages = Schema.Struct({
	pages: Schema.Array(Schema.Record(Schema.String, Schema.FiniteFromString)),
	at: Schema.Date
});

describe('canonical JSON', () => {
	it('encodes through the Schema with every object key sorted', () => {
		const encode = stringifier(Pages);
		const at = new Date('2026-11-03T00:00:00.000Z');
		const json = '{"at":"2026-11-03T00:00:00.000Z","pages":[{"a":"1","b":"2","c":"3"},{}]}';
		expect(encode({ pages: [{ c: 3, a: 1, b: 2 }, {}], at })).toBe(json);
		expect(encode({ at, pages: [{ b: 2, c: 3, a: 1 }, {}] })).toBe(json);
	});
});
