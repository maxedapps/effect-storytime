import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { Decider, Program } from 'effect-storytime';
import {
	at,
	Check,
	Event,
	Grant,
	Granted,
	membership,
	Memberships,
	none,
	NotActive,
	Revoke
} from './examples/membership.ts';

const handle = Decider.handle(membership, Memberships);
const granted = { source: 'teachable', active: true, checkedAt: at } as const;

describe('Decider.handle', () => {
	it.effect(
		'decides, saves in one transaction and gives the events and the state after the commit',
		() =>
			Effect.gen(function* () {
				const store = yield* Memberships;
				expect(yield* handle('u1', Grant.make({ source: 'teachable', at }))).toEqual({
					events: [Granted.make({ source: 'teachable', at })],
					state: granted
				});
				expect(yield* store.log).toEqual(['begin', 'load u1', 'save u1 Granted', 'commit']);
				expect(yield* store.load('u1')).toEqual(Option.some(granted));
			}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('runs each command in the span Decider.handle', () =>
		Effect.gen(function* () {
			const store = yield* Memberships;
			const spans: Array<string> = [];
			const traced = Memberships.of({
				...store,
				transaction: (effect) =>
					Effect.currentSpan.pipe(
						Effect.orDie,
						Effect.flatMap((span) => {
							spans.push(span.name);
							return store.transaction(effect);
						})
					)
			});
			yield* handle('u1', Check.make({ active: false, at })).pipe(
				Effect.provideService(Memberships, traced)
			);
			expect(spans).toEqual(['Decider.handle']);
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('gives the loaded state and saves nothing when there are no events', () =>
		Effect.gen(function* () {
			expect(yield* handle('u1', Check.make({ active: false, at }))).toEqual({
				events: [],
				state: none
			});
			yield* handle('u2', Grant.make({ source: 'teachable', at }));
			expect(yield* handle('u2', Check.make({ active: true, at: 'later' }))).toEqual({
				events: [],
				state: granted
			});
			expect(yield* (yield* Memberships).log).toEqual([
				'begin',
				'load u1',
				'commit',
				'begin',
				'load u2',
				'save u2 Granted',
				'commit',
				'begin',
				'load u2',
				'commit'
			]);
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('fails with the rejection and saves nothing', () =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(handle('u1', Revoke.make({})))).toEqual(NotActive.make({}));
			expect(yield* (yield* Memberships).log).toEqual(['begin', 'load u1', 'commit']);
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('dies with the broken invariant before saving, so the transaction never commits', () =>
		Effect.gen(function* () {
			const careless = Decider.make({
				...membership,
				evolve: (current, event) =>
					Event.guards.Granted(event)
						? { ...membership.evolve(current, event), checkedAt: null }
						: membership.evolve(current, event)
			});
			const defect = yield* Decider.handle(careless, Memberships)(
				'u1',
				Grant.make({ source: 'teachable', at })
			).pipe(Effect.catchDefect(Effect.succeed));
			const broken = new Program.InvariantBroken({
				invariant: 'checkedWhenActive',
				state: '{"active":1,"checkedAt":null,"source":"teachable"}'
			});
			expect(defect).toEqual(broken);
			expect(broken._tag).toBe('InvariantBroken');
			expect(broken.message).toBe(
				'invariant checkedWhenActive does not hold for {"active":1,"checkedAt":null,"source":"teachable"}'
			);
			expect(yield* (yield* Memberships).log).toEqual(['begin', 'load u1']);
		}).pipe(Effect.provide(Memberships.layer))
	);
});
