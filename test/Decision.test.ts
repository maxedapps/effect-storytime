import { describe, expect, it } from '@effect/vitest';
import { Effect, Result, Schema } from 'effect';
import { Decider, Decision, Story } from '../src/index.ts';
import {
	AlreadyActive,
	at,
	Check,
	Checked,
	Grant,
	Granted,
	later,
	membership,
	type Event,
	Input,
	type Membership,
	Memberships,
	none,
	NotActive,
	type Rejection,
	Revoke,
	Revoked,
	variant
} from './examples/membership.ts';

const { given, when, accepted, rejected, state, satisfies } = Decision;

const grant = Grant.make({ source: 'teachable', at });
const granted = Granted.make({ source: 'teachable', at });
const active: Membership = { source: 'teachable', active: true, checkedAt: at };
const revoke = Revoke.make({});

const lifecycle = Decision.make(
	'a membership from grant to check',
	membership,
	given(none),
	when(grant),
	accepted(granted),
	state(active),
	when(Grant.make({ source: 'teachable', at: later })),
	rejected(AlreadyActive.make({ since: at })),
	when(Check.make({ active: true, at: later })),
	accepted(),
	when(Check.make({ active: false, at: later })),
	accepted(Checked.make({ active: false, at: later })),
	satisfies('inactive', (current) => !current.active),
	when(revoke),
	rejected(NotActive.make({}))
);

const inactive: Membership = { source: 'teachable', active: false, checkedAt: later };
const reachedInactive = {
	state: inactive,
	final: '{"active":0,"checkedAt":"2026-11-04T00:00:00.000Z","source":"teachable"}'
};

const failure = (decision: Decision.Decision<Membership, Input, Event, Rejection>) =>
	Effect.flip(Decision.run(decision));

const evolved = (evolve: (current: Membership, event: Event) => Membership) =>
	failure(
		Decision.make('evolve', Decider.make({ ...membership, evolve }), given(none), when(grant))
	);

const blank = { disableChecks: true };

describe('Decision', () => {
	it('renders lines from the value alone, with times and bits as stored', () => {
		expect(Decision.lines(lifecycle)).toEqual([
			'given {"active":0,"checkedAt":null,"source":"teachable"}',
			'when Grant {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}',
			'accepted Granted {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}',
			'state {"active":1,"checkedAt":"2026-11-03T00:00:00.000Z","source":"teachable"}',
			'when Grant {"at":"2026-11-04T00:00:00.000Z","source":"teachable"}',
			'rejected AlreadyActive {"since":"2026-11-03T00:00:00.000Z"}',
			'when Check {"active":true,"at":"2026-11-04T00:00:00.000Z"}',
			'accepted none',
			'when Check {"active":false,"at":"2026-11-04T00:00:00.000Z"}',
			'accepted Checked {"active":false,"at":"2026-11-04T00:00:00.000Z"}',
			'satisfies inactive',
			'when Revoke',
			'rejected NotActive'
		]);
	});

	it.effect('runs a decision in memory and returns its final state', () =>
		Effect.gen(function* () {
			expect(yield* Decision.run(lifecycle)).toEqual(reachedInactive);
		})
	);

	it.effect('runs the same decision through handle on a real store', () =>
		Effect.gen(function* () {
			expect(yield* Decision.against(lifecycle, Memberships, 'u1')).toEqual(reachedInactive);
			expect(yield* (yield* Memberships).log).toEqual([
				'begin',
				'save u1',
				'commit',
				'begin',
				'load u1',
				'save u1 Granted',
				'commit',
				'load u1',
				'begin',
				'load u1',
				'commit',
				'begin',
				'load u1',
				'commit',
				'begin',
				'load u1',
				'save u1 Checked',
				'commit',
				'load u1',
				'begin',
				'load u1',
				'commit',
				'load u1'
			]);
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('fails against a store as it fails in memory', () =>
		Effect.gen(function* () {
			const wrong = Decision.make('wrong', membership, given(none), when(grant), state(none));
			expect(yield* Effect.flip(Decision.against(wrong, Memberships, 'u1'))).toMatchObject({
				step: 3,
				message: 'a when needs accepted(...) or rejected(...) right after it'
			});
			const stale = Decision.make(
				'stale',
				membership,
				given(none),
				when(grant),
				accepted(granted),
				state(none)
			);
			expect(yield* Effect.flip(Decision.against(stale, Memberships, 'u2'))).toMatchObject({
				step: 4,
				message: 'the state differs',
				expected: '{"active":0,"checkedAt":null,"source":"teachable"}',
				actual: '{"active":1,"checkedAt":"2026-11-03T00:00:00.000Z","source":"teachable"}'
			});
		}).pipe(Effect.provide(Memberships.layer))
	);

	it.effect('holds a store run to every strict rule', () =>
		Effect.gen(function* () {
			const broken = Decision.make('given', membership, given({ ...none, active: true }));
			expect(yield* Effect.flip(Decision.against(broken, Memberships, 'u1'))).toMatchObject({
				step: 1,
				message: 'invariant checkedWhenActive does not hold'
			});
			const unchecked = Decider.make({
				...membership,
				evolve: (current) => ({ ...current, active: true })
			});
			const evolving = Decision.make(
				'evolved',
				unchecked,
				given(none),
				when(grant),
				accepted(granted)
			);
			expect(yield* Effect.flip(Decision.against(evolving, Memberships, 'u2'))).toMatchObject({
				step: 2,
				message: 'invariant checkedWhenActive does not hold'
			});
			const throwing = variant(() => {
				throw new Error('no rule');
			});
			const throws = Decision.make('throws', throwing, given(none), when(grant));
			expect(yield* Effect.flip(Decision.against(throws, Memberships, 'u3'))).toMatchObject({
				step: 2,
				message: 'decide threw: Error: no rule'
			});
			const invalid = Decider.make({
				...membership,
				evolve: (current) => ({ ...current, checkedAt: '' })
			});
			const drops = Decision.make('invalid', invalid, given(none), when(grant), accepted(granted));
			expect(yield* Effect.flip(Decision.against(drops, Memberships, 'u4'))).toMatchObject({
				step: 2,
				message:
					'the state is invalid: Expected a value with a length of at least 1\n  at ["checkedAt"]'
			});
		}).pipe(Effect.provide(Memberships.layer))
	);

	describe('fails', () => {
		it.effect('a decision that does not start with given(state)', () =>
			Effect.gen(function* () {
				const empty = yield* failure(Decision.make('empty', membership));
				expect(empty).toBeInstanceOf(Story.StoryFailure);
				expect(empty).toMatchObject({
					title: 'empty',
					step: 1,
					line: '',
					message: 'a decision starts with given(state)'
				});
				expect(
					yield* failure(Decision.make('late', membership, when(revoke), given(none)))
				).toMatchObject({ step: 1, line: 'when Revoke' });
				expect(
					yield* failure(Decision.make('twice', membership, given(none), given(none)))
				).toMatchObject({ step: 2, message: 'given(state) comes once, first' });
			})
		);

		it.effect('a when without accepted or rejected right after it', () =>
			Effect.gen(function* () {
				const unanswered = 'a when needs accepted(...) or rejected(...) right after it';
				expect(
					yield* failure(Decision.make('next', membership, given(none), when(revoke), when(revoke)))
				).toMatchObject({ step: 3, line: 'when Revoke', message: unanswered });
				expect(
					yield* failure(Decision.make('end', membership, given(none), when(revoke)))
				).toMatchObject({ step: 3, line: 'end', message: unanswered });
			})
		);

		it.effect('accepted or rejected without a when', () =>
			Effect.gen(function* () {
				expect(
					yield* failure(Decision.make('accepted', membership, given(none), accepted()))
				).toMatchObject({ step: 2, message: 'accepted(...) comes right after a when' });
				expect(
					yield* failure(
						Decision.make(
							'rejected',
							membership,
							given(none),
							when(grant),
							accepted(granted),
							rejected(NotActive.make({}))
						)
					)
				).toMatchObject({ step: 4, message: 'rejected(...) comes right after a when' });
			})
		);

		it.effect('other events, in another order or a rejection instead', () =>
			Effect.gen(function* () {
				const more = Decision.make(
					'more',
					membership,
					given(none),
					when(grant),
					accepted(granted, Revoked.make({}))
				);
				expect(yield* failure(more)).toMatchObject({
					step: 3,
					line: 'accepted Granted {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}, Revoked',
					message: 'the events differ',
					expected: 'Granted {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}\nRevoked',
					actual: 'Granted {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}'
				});
				const refused = Decision.make('refused', membership, given(none), when(revoke), accepted());
				expect(yield* failure(refused)).toMatchObject({
					step: 3,
					message: 'the input was rejected',
					expected: '',
					actual: 'NotActive'
				});
			})
		);

		it.effect('another rejection, or none', () =>
			Effect.gen(function* () {
				const other = Decision.make(
					'other',
					membership,
					given(none),
					when(revoke),
					rejected(AlreadyActive.make({ since: null }))
				);
				expect(yield* failure(other)).toMatchObject({
					step: 3,
					message: 'the rejection differs',
					expected: 'AlreadyActive {"since":null}',
					actual: 'NotActive'
				});
				const taken = Decision.make(
					'taken',
					membership,
					given(none),
					when(grant),
					rejected(NotActive.make({}))
				);
				expect(yield* failure(taken)).toMatchObject({
					step: 3,
					message: 'the input was accepted',
					expected: 'NotActive',
					actual: 'Granted {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}'
				});
			})
		);

		it.effect('a state that differs or fails a check', () =>
			Effect.gen(function* () {
				expect(
					yield* failure(Decision.make('state', membership, given(none), state(active)))
				).toMatchObject({
					step: 2,
					message: 'the state differs',
					expected: '{"active":1,"checkedAt":"2026-11-03T00:00:00.000Z","source":"teachable"}',
					actual: '{"active":0,"checkedAt":null,"source":"teachable"}'
				});
				const check = Decision.make(
					'check',
					membership,
					given(none),
					satisfies('active', (current) => current.active)
				);
				expect(yield* failure(check)).toMatchObject({
					step: 2,
					message: 'the state does not satisfy active',
					actual: '{"active":0,"checkedAt":null,"source":"teachable"}'
				});
				const explodes = Decision.make(
					'explodes',
					membership,
					given(none),
					satisfies('explodes', () => {
						throw new Error('boom');
					})
				);
				expect(yield* failure(explodes)).toMatchObject({
					step: 2,
					message: 'explodes threw: Error: boom'
				});
			})
		);

		it.effect('invalid given states, inputs and expected values, checked on the Type side', () =>
			Effect.gen(function* () {
				const empty = 'Expected a value with a length of at least 1\n  at ';
				expect(
					yield* failure(Decision.make('given', membership, given({ ...none, checkedAt: '' })))
				).toMatchObject({ step: 1, message: `the state is invalid: ${empty}["checkedAt"]` });
				const input = Decision.make(
					'input',
					membership,
					given(none),
					when(Grant.make({ source: 'teachable', at: '' }, blank))
				);
				expect(yield* failure(input)).toMatchObject({
					step: 2,
					message: `the input is invalid: ${empty}["at"]`
				});
				const event = Decision.make(
					'event',
					membership,
					given(none),
					when(grant),
					accepted(Granted.make({ source: 'teachable', at: '' }, blank))
				);
				expect(yield* failure(event)).toMatchObject({
					step: 3,
					message: `the event is invalid: ${empty}["at"]`
				});
				const expected = Decision.make(
					'expected',
					membership,
					given(none),
					state({ ...none, checkedAt: '' })
				);
				expect(yield* failure(expected)).toMatchObject({
					step: 2,
					message: `the state is invalid: ${empty}["checkedAt"]`
				});
				const rejection = Decision.make(
					'rejection',
					membership,
					given(none),
					when(revoke),
					rejected(AlreadyActive.make({ since: '' }, blank))
				);
				expect(yield* failure(rejection)).toMatchObject({
					step: 3,
					message: `the rejection is invalid: ${empty}["since"]`
				});
			})
		);

		it.effect('a state that does not survive JSON', () =>
			Effect.gen(function* () {
				const opaque = Decider.make({
					...membership,
					State: Schema.Struct({ value: Schema.Unknown }),
					initial: { value: null },
					decide: () => Result.succeed([]),
					evolve: (current) => current,
					invariants: {}
				});
				expect(
					yield* Effect.flip(Decision.run(Decision.make('json', opaque, given({ value: 1n }))))
				).toMatchObject({
					step: 1,
					message: 'the state does not survive JSON: Expected JSON value\n  at ["value"]'
				});
			})
		);

		it.effect('a given state or evolved state that breaks an invariant', () =>
			Effect.gen(function* () {
				expect(
					yield* failure(Decision.make('given', membership, given({ ...none, active: true })))
				).toMatchObject({
					step: 1,
					message: 'invariant checkedWhenActive does not hold',
					actual: '{"active":1,"checkedAt":null,"source":"teachable"}'
				});
				const unchecked = Decider.make({
					...membership,
					evolve: (current) => ({ ...current, active: true })
				});
				expect(
					yield* failure(
						Decision.make('evolved', unchecked, given(none), when(grant), accepted(granted))
					)
				).toMatchObject({ step: 2, message: 'invariant checkedWhenActive does not hold' });
				const lax = Decider.make({
					State: membership.State,
					Input: membership.Input,
					Event: membership.Event,
					Rejection: membership.Rejection,
					initial: none,
					decide: membership.decide,
					evolve: membership.evolve
				});
				yield* Decision.run(Decision.make('lax', lax, given({ ...none, active: true })));
			})
		);

		it.effect('a decide that throws, mutates, drifts or gives invalid events', () =>
			Effect.gen(function* () {
				const throwing = variant(() => {
					throw new Error('no rule');
				});
				expect(
					yield* failure(Decision.make('throws', throwing, given(none), when(grant)))
				).toMatchObject({ step: 2, message: 'decide threw: Error: no rule' });
				const mutating = variant((current, input) => {
					Object.assign(current, { checkedAt: later });
					return membership.decide(current, input);
				});
				expect(
					yield* failure(Decision.make('mutates', mutating, given(none), when(grant)))
				).toMatchObject({ step: 2, message: 'decide changed its input' });
				let calls = 0;
				const drifting = variant(() => {
					calls += 1;
					return calls === 1 ? Result.succeed([]) : Result.fail(NotActive.make({}));
				});
				expect(
					yield* failure(Decision.make('drifts', drifting, given(none), when(grant)))
				).toMatchObject({
					step: 2,
					message: 'decide gave two results for the same input',
					expected: 'accepted []',
					actual: 'rejected {"_tag":"NotActive"}'
				});
				const refusing = variant(() => Result.fail(AlreadyActive.make({ since: '' }, blank)));
				expect(
					yield* failure(Decision.make('refusing', refusing, given(none), when(grant)))
				).toMatchObject({
					step: 2,
					message:
						'the rejection is invalid: Expected a value with a length of at least 1\n  at ["since"]'
				});
				const invalid = variant(() =>
					Result.succeed([Granted.make({ source: 'teachable', at: '' }, blank)])
				);
				expect(
					yield* failure(Decision.make('invalid', invalid, given(none), when(grant)))
				).toMatchObject({
					step: 2,
					message: 'the event is invalid: Expected a value with a length of at least 1\n  at ["at"]'
				});
			})
		);

		it.effect('an evolve that throws, mutates or gives an invalid state', () =>
			Effect.gen(function* () {
				expect(
					yield* evolved(() => {
						throw new Error('no fold');
					})
				).toMatchObject({ step: 2, message: 'evolve threw: Error: no fold' });
				expect(
					yield* evolved((current, event) => {
						Object.assign(current, { source: 'manual' });
						return membership.evolve(current, event);
					})
				).toMatchObject({ step: 2, message: 'evolve changed its input' });
				expect(yield* evolved((current) => ({ ...current, checkedAt: '' }))).toMatchObject({
					step: 2,
					message:
						'the state is invalid: Expected a value with a length of at least 1\n  at ["checkedAt"]'
				});
			})
		);

		it.effect('a decide or evolve that mutates a value it shares with the decision', () =>
			Effect.gen(function* () {
				const shared = Granted.make({ source: 'teachable', at });
				const sharing = Decider.make({
					...membership,
					decide: () => Result.succeed([shared]),
					evolve: (current, event) => {
						Object.assign(event, { at: later });
						return membership.evolve(current, event);
					}
				});
				const events = Decision.make('events', sharing, given(none), when(grant), accepted(shared));
				const before = Decision.lines(events);
				expect(yield* failure(events)).toMatchObject({
					step: 2,
					message: 'evolve changed its input'
				});
				expect(Decision.lines(events)).toEqual(before);
				expect(shared).toEqual(granted);
				const reached = { ...active };
				const keeping = Decider.make({
					...membership,
					decide: (current, input) => {
						if (Input.guards.Revoke(input)) Object.assign(current, { checkedAt: later });
						return membership.decide(current, input);
					},
					evolve: () => reached
				});
				const states = Decision.make(
					'states',
					keeping,
					given(none),
					when(grant),
					accepted(granted),
					state(reached),
					when(revoke)
				);
				const shown = Decision.lines(states);
				expect(yield* failure(states)).toMatchObject({
					step: 5,
					message: 'decide changed its input'
				});
				expect(Decision.lines(states)).toEqual(shown);
				expect(reached).toEqual(active);
			})
		);
	});
});
