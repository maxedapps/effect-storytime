// The membership Decider as docs/decider.md, docs/decisions.md and docs/explorations.md show it.
import { describe, expect, layer } from '@effect/vitest';
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
	membership,
	Memberships,
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

layer(Memberships.layer)('Decider.handle', (it) => {
	it.effect('commits the events and the state they reach, or fails with the rejection', () =>
		Effect.gen(function* () {
			// #region handle
			const grant = Decider.handle(membership, Memberships);

			const { events, state } = yield* grant('user-2', Grant.make({ source: 'teachable', at }));
			expect(events).toEqual([Granted.make({ source: 'teachable', at })]);
			expect(state).toEqual({ source: 'teachable', active: true, checkedAt: at });

			// A rejection is the typed error, and nothing is saved.
			const again = yield* grant('user-2', Grant.make({ source: 'teachable', at: later })).pipe(
				Effect.catchTag('AlreadyActive', ({ since }) => Effect.succeed(`active since ${since}`))
			);
			expect(again).toBe(`active since ${at}`);
			// #endregion handle
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
