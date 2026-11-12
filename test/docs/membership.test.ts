// The membership Decider as docs/decider.md, docs/decisions.md and docs/explorations.md show it.
import { describe, expect, expectTypeOf, layer } from '@effect/vitest';
import { Effect, Option, Result } from 'effect';
import { Decider, Program } from 'effect-storytime';
import { Decision, Exploration } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import {
	AlreadyActive,
	at,
	Check,
	Checked,
	Command,
	Event,
	Grant,
	Granted,
	later,
	Manual,
	type Membership,
	membership,
	Memberships,
	NotActive,
	type Rejection,
	Revoke,
	Revoked
} from '../examples/membership.ts';

// #region lifecycle
// The step builders, typed by the Decider.
const decision = Decision.of(membership);

const lifecycle = Decision.make(
	'a membership is granted once and revoked once',
	membership,
	decision.given(membership.initial),
	decision.when(Grant.make({ source: 'teachable', at })),
	decision.accepted(Granted.make({ source: 'teachable', at })),
	decision.when(Grant.make({ source: 'teachable', at: later })),
	decision.rejected(AlreadyActive.make({ since: at })),
	decision.when(Revoke.make({})),
	decision.accepted(Revoked.make({})),
	decision.state({ source: 'teachable', active: false, checkedAt: at })
);
// #endregion lifecycle

// #region checks
const checks = Decision.make(
	'a check changes only what it finds changed',
	membership,
	decision.given({ source: 'teachable', active: true, checkedAt: at }),
	// No change, no events: the decision is accepted with none.
	decision.when(Check.make({ active: true, at: later })),
	decision.accepted(),
	decision.satisfies('still active', (state) => state.active),
	decision.when(Check.make({ active: false, at: later })),
	decision.accepted(Checked.make({ active: false, at: later })),
	decision.state({ source: 'teachable', active: false, checkedAt: later })
);

const manual = Decision.make(
	'a manual membership is never checked',
	membership,
	decision.given({ source: 'manual', active: true, checkedAt: at }),
	decision.when(Check.make({ active: false, at: later })),
	decision.rejected(Manual.make({}))
);
// #endregion checks

// #region explore
// The Decider's `initial` and any command the Command Schema allows, by default.
const holds = Exploration.decisions('any commands keep a membership valid', membership, {
	// Named assertions on every command a path decides: an accepted revoke ends the membership.
	properties: {
		revokeEnds: ({ command, decided, after }) =>
			!Command.guards.Revoke(command) || Result.isFailure(decided) || !after.active
	}
});
// #endregion explore

// #region vitest
describe('membership', () => {
	Vitest.stories(lifecycle, checks, manual, holds);
	Vitest.covers(membership, [lifecycle, checks, manual, holds]);
});

// The same decision through `handle`'s transaction on a Store. Here the Store keeps rows in
// memory; an app passes its database layer.
layer(Memberships.layer)('membership in its Store', (it) => {
	it.effect('a membership is granted once and revoked once', (ctx) =>
		Vitest.tell(ctx, lifecycle, Decision.against(lifecycle, Memberships, 'user-1'))
	);
});
// #endregion vitest

// #region widening
// A helper typed with the whole Rejection union widens the handler that calls it:
// Revoke's calls could now fail with any rejection.
const requireActiveWide = (current: Membership): Result.Result<Membership, Rejection> =>
	current.active ? Result.succeed(current) : Result.fail(NotActive.make({}));
// The fix: leave its return type inferred, so Revoke keeps only NotActive.
const requireActive = (current: Membership) =>
	current.active ? Result.succeed(current) : Result.fail(NotActive.make({}));

const wide = Decider.make({
	...membership,
	decide: {
		...membership.decide,
		Revoke: (current) => Result.map(requireActiveWide(current), () => [Revoked.make({})])
	}
});
const narrow = Decider.make({
	...membership,
	decide: {
		...membership.decide,
		Revoke: (current) => Result.map(requireActive(current), () => [Revoked.make({})])
	}
});
const revokeWide = Decider.handle(wide, Memberships)('user-4', Revoke.make({}));
const revoke = Decider.handle(narrow, Memberships)('user-4', Revoke.make({}));
expectTypeOf<Effect.Error<typeof revokeWide>>().toEqualTypeOf<Rejection>();
expectTypeOf<Effect.Error<typeof revoke>>().toEqualTypeOf<typeof NotActive.Type>();

// The same for a helper around handle: one taking Command gives every handler's
// rejections, one generic in the command keeps each call's own.
const handleMembership = Decider.handle(membership, Memberships);
const sendWide = (key: string, command: Command) =>
	handleMembership(key, command).pipe(Effect.withSpan('membership'));
const send = <C extends Command>(key: string, command: C) =>
	handleMembership(key, command).pipe(Effect.withSpan('membership'));
expectTypeOf<Effect.Error<ReturnType<typeof sendWide>>>().toEqualTypeOf<Rejection>();
const revokeSent = send('user-4', Revoke.make({}));
expectTypeOf<Effect.Error<typeof revokeSent>>().toEqualTypeOf<typeof NotActive.Type>();
// #endregion widening

layer(Memberships.layer)('Decider.handle', (it) => {
	it.effect('commits the events and the state they reach, or fails with the rejection', () =>
		Effect.gen(function* () {
			// #region handle
			const handled = Decider.handle(membership, Memberships);

			const { events, state } = yield* handled('user-2', Grant.make({ source: 'teachable', at }));
			expect(events).toEqual([Granted.make({ source: 'teachable', at })]);
			expect(state).toEqual({ source: 'teachable', active: true, checkedAt: at });

			// A rejection is the typed error, and nothing is saved. The Grant handler rejects only
			// with AlreadyActive, so catching it leaves no error.
			const again: Effect.Effect<string, never, Memberships> = handled(
				'user-2',
				Grant.make({ source: 'teachable', at: later })
			).pipe(
				Effect.as('granted'),
				Effect.catchTag('AlreadyActive', ({ since }) => Effect.succeed(`active since ${since}`))
			);
			expect(yield* again).toBe(`active since ${at}`);
			// #endregion handle
		})
	);

	it.effect('keeps per-command types only through narrowly typed helpers', () =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(revokeWide)).toEqual(NotActive.make({}));
			expect(yield* Effect.flip(revoke)).toEqual(NotActive.make({}));
			expect(yield* Effect.flip(sendWide('user-4', Revoke.make({})))).toEqual(NotActive.make({}));
			expect(yield* Effect.flip(revokeSent)).toEqual(NotActive.make({}));
		})
	);

	it.effect('dies before saving a state that breaks an invariant', () =>
		Effect.gen(function* () {
			// #region invariant
			// A bug: this evolve forgets when a granted membership was checked.
			const careless = Decider.make({
				...membership,
				evolve: (state, event) =>
					Event.guards.Granted(event) ? { ...state, active: true } : membership.evolve(state, event)
			});
			const defect = yield* Decider.handle(careless, Memberships)(
				'user-3',
				Grant.make({ source: 'teachable', at })
			).pipe(Effect.catchDefect(Effect.succeed));
			expect(defect).toEqual(
				new Program.InvariantBroken({
					invariant: 'checkedWhenActive',
					state: '{"active":1,"checkedAt":null,"source":"teachable"}'
				})
			);
			// Nothing was saved: the key still has no state.
			const store = yield* Memberships;
			expect(yield* store.load('user-3')).toEqual(Option.none());
			// #endregion invariant
		})
	);
});
