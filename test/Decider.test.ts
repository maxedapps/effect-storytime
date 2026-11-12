import { describe, expect, expectTypeOf, it } from '@effect/vitest';
import { Effect, Option, Result } from 'effect';
import { Decider, Program } from 'effect-storytime';
import {
	AlreadyActive,
	at,
	Check,
	Checked,
	Command,
	Event,
	Grant,
	Granted,
	Manual,
	membership,
	Memberships,
	none,
	NotActive,
	Rejection,
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

	it.effect('types each command by its handler: only its events and its rejections', () =>
		Effect.gen(function* () {
			const grant = handle('u1', Grant.make({ source: 'teachable', at }));
			const revoke = handle('u1', Revoke.make({}));
			const check = handle('u1', Check.make({ active: false, at }));
			expectTypeOf<Effect.Success<typeof grant>['events']>().toEqualTypeOf<
				ReadonlyArray<typeof Granted.Type>
			>();
			expectTypeOf<Effect.Error<typeof grant>>().toEqualTypeOf<typeof AlreadyActive.Type>();
			expectTypeOf<Effect.Error<typeof revoke>>().toEqualTypeOf<typeof NotActive.Type>();
			expectTypeOf<Effect.Success<typeof check>['events']>().toEqualTypeOf<
				ReadonlyArray<typeof Checked.Type>
			>();
			expectTypeOf<Effect.Error<typeof check>>().toEqualTypeOf<typeof Manual.Type>();
			// A command typed as the whole union may give any event or rejection.
			const any = (command: Command) => handle('u1', command);
			expectTypeOf<Effect.Success<ReturnType<typeof any>>['events']>().toEqualTypeOf<
				ReadonlyArray<Event>
			>();
			expectTypeOf<Effect.Error<ReturnType<typeof any>>>().toEqualTypeOf<Rejection>();
			// A handler that only rejects gives no events.
			const refusing = Decider.make({
				...membership,
				decide: { ...membership.decide, Revoke: () => Result.fail(NotActive.make({})) }
			});
			const refused = Decider.handle(refusing, Memberships)('u1', Revoke.make({}));
			expectTypeOf<Effect.Success<typeof refused>['events']>().toEqualTypeOf<
				ReadonlyArray<never>
			>();
			expectTypeOf<Effect.Error<typeof refused>>().toEqualTypeOf<typeof NotActive.Type>();
			expect(yield* Effect.flip(revoke)).toEqual(NotActive.make({}));
			expect(yield* grant).toEqual({
				events: [Granted.make({ source: 'teachable', at })],
				state: granted
			});
			expect(yield* Effect.flip(any(Grant.make({ source: 'teachable', at })))).toEqual(
				AlreadyActive.make({ since: at })
			);
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

	it.effect('dies with the invariant that changed the state before saving', () =>
		Effect.gen(function* () {
			const tampering = Decider.make({
				...membership,
				invariants: { touches: (current) => Boolean(Object.assign(current, { active: false })) }
			});
			const defect = yield* Decider.handle(tampering, Memberships)(
				'u1',
				Grant.make({ source: 'teachable', at })
			).pipe(Effect.catchDefect(Effect.succeed));
			const changed = new Program.InvariantChanged({
				invariant: 'touches',
				before: `{"active":1,"checkedAt":"${at}","source":"teachable"}`,
				after: `{"active":0,"checkedAt":"${at}","source":"teachable"}`
			});
			expect(defect).toEqual(changed);
			expect(changed._tag).toBe('InvariantChanged');
			expect(changed.message).toBe(
				`invariant touches changed ${changed.before} to ${changed.after}`
			);
			expect(yield* (yield* Memberships).log).toEqual(['begin', 'load u1']);
		}).pipe(Effect.provide(Memberships.layer))
	);
});
