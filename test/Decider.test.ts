import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { Decider } from '../src/index.ts';
import {
	at,
	Check,
	Grant,
	Granted,
	membership,
	Memberships,
	NotActive,
	Revoke
} from './examples/membership.ts';

const handle = Decider.handle(membership, Memberships);

describe('Decider.handle', () => {
	it.effect('decides from the initial state and saves the events in one transaction', () =>
		Effect.gen(function* () {
			const store = yield* Memberships;
			expect(yield* handle('u1', Grant.make({ source: 'teachable', at }))).toEqual([
				Granted.make({ source: 'teachable', at })
			]);
			expect(yield* store.load('u1')).toEqual(
				Option.some({ source: 'teachable', active: true, checkedAt: at })
			);
			expect(yield* store.log).toEqual([
				'begin',
				'load u1',
				'save u1 Granted',
				'commit',
				'load u1'
			]);
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('saves nothing when there are no events', () =>
		Effect.gen(function* () {
			expect(yield* handle('u1', Check.make({ active: false, at }))).toEqual([]);
			expect(yield* (yield* Memberships).log).toEqual(['begin', 'load u1', 'commit']);
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('fails with the rejection and saves nothing', () =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(handle('u1', Revoke.make({})))).toEqual(NotActive.make({}));
			expect(yield* (yield* Memberships).log).toEqual(['begin', 'load u1', 'commit']);
		}).pipe(Effect.provide(Memberships.layer))
	);
});
