import { describe, expect, expectTypeOf, it } from '@effect/vitest';
import { Arbitrary, Effect, Result, Schema } from 'effect';
import { Decider, Program } from 'effect-storytime';
import { Decision, Exploration, Story, Tale } from 'effect-storytime/testing';
import { chat, Command, Message, ready } from './examples/chat.ts';
import * as Lamp from './examples/lamp.ts';
import { membership, none, NotActive, Revoke } from './examples/membership.ts';

const { Asked, Answered, Stopped } = Message.cases;
const { Ask, SaveTurn } = Command.cases;

const story = Story.of(chat);
const decision = Decision.of(membership);
const lamp = Story.of(Lamp.lamp);

const asked = Asked.make({ turn: 't1', text: 'Why?' });
const ask = Ask.make({ turn: 't1', text: 'Why?' });
const saved = SaveTurn.make({ id: 't1', question: 'Why?', answer: '' });

const stops = Story.make(
	'a question is stopped',
	chat,
	story.given(ready(1)),
	story.send(asked),
	story.commands(ask),
	story.send(Stopped.make({}))
);

const switches = Exploration.make('the lamp switches', Lamp.lamp, {
	given: Arbitrary.Constant(Lamp.off),
	send: Arbitrary.Constant(Lamp.switched()),
	restarts: false,
	runs: 3,
	steps: 5
});

const Door = Schema.TaggedUnion({ Open: {}, Closed: {} });
const Push = Schema.TaggedUnion({ Push: {} });
const Swung = Schema.TaggedUnion({ Swung: {} });
const Stuck = Schema.TaggedUnion({ Stuck: {} });

const doorRules = {
	State: Door,
	Command: Push,
	Event: Swung,
	Rejection: Stuck,
	initial: Door.cases.Closed.make({}),
	decide: { Push: () => Result.succeed([Swung.cases.Swung.make({})]) },
	evolve: (current: typeof Door.Type) =>
		Door.guards.Open(current) ? Door.cases.Closed.make({}) : Door.cases.Open.make({})
};

const door = Decider.make(doorRules);

const swings = Exploration.decisions('the door swings', door, { runs: 5 });

const revokes = Decision.make(
	'only an active membership is revoked',
	membership,
	decision.given(none),
	decision.when(Revoke.make({})),
	decision.rejected(NotActive.make({}))
);

describe('Tale', () => {
	it.effect('renders and runs a story, an exploration and a decision alike', () =>
		Effect.gen(function* () {
			expect(Tale.lines(stops)).toEqual(Story.lines(stops));
			expect(yield* Tale.run(stops)).toEqual({
				finals: [{ order: [], final: 'Ready {"left":1,"turns":[]}' }],
				cases: ['Command.Ask', 'Message.Asked', 'Message.Stopped', 'Model.Asking', 'Model.Ready']
			});
			expect(Tale.lines(switches)).toEqual(Exploration.lines(switches));
			expect(yield* Tale.run(switches)).toEqual({ runs: 3, cases: ['Message.Switched'] });
			expect(Tale.lines(revokes)).toEqual(Decision.lines(revokes));
			expect(yield* Tale.run(revokes)).toEqual(yield* Decision.run(revokes));
		})
	);

	it('lists every case of a Program, Models only for a tagged union', () => {
		expect(Tale.cases(chat)).toEqual([
			'Model.Ready',
			'Model.Asking',
			'Model.Limited',
			'Model.SignedOut',
			'Message.Asked',
			'Message.Delta',
			'Message.Answered',
			'Message.Refused',
			'Message.Stopped',
			'Command.Ask',
			'Command.SaveTurn'
		]);
		expect(Tale.cases(Lamp.lamp)).toEqual(['Message.Switched', 'Command.Log']);
	});

	it('lists every case of a Decider, States only for a tagged union', () => {
		expect(Tale.cases(membership)).toEqual([
			'Command.Grant',
			'Command.Check',
			'Command.Revoke',
			'Event.Granted',
			'Event.Checked',
			'Event.Revoked',
			'Rejection.AlreadyActive',
			'Rejection.NotActive',
			'Rejection.Manual'
		]);
		expect(Tale.cases(door)).toEqual([
			'State.Open',
			'State.Closed',
			'Command.Push',
			'Event.Swung',
			'Rejection.Stuck'
		]);
	});

	it.effect("passes when a Decider's decisions and explorations touch every case together", () =>
		Tale.covers(membership, [revokes, Exploration.decisions('memberships', membership)])
	);

	it.effect('names the cases of a Decider no tale touches', () =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(Tale.covers(door, [swings]))).toEqual(
				new Tale.Uncovered({ missing: ['Rejection.Stuck'] })
			);
			expect(yield* Effect.flip(Tale.covers(membership, [revokes]))).toEqual(
				new Tale.Uncovered({
					missing: [
						'Command.Grant',
						'Command.Check',
						'Event.Granted',
						'Event.Checked',
						'Event.Revoked',
						'Rejection.AlreadyActive',
						'Rejection.Manual'
					]
				})
			);
		})
	);

	it.effect('counts every state the events of one command pass through', () =>
		Effect.gen(function* () {
			const revolving = Decider.make({
				...doorRules,
				decide: {
					Push: () => Result.succeed([Swung.cases.Swung.make({}), Swung.cases.Swung.make({})])
				}
			});
			const revolves = Exploration.decisions('the door revolves', revolving, { runs: 5 });
			expect(yield* Effect.flip(Tale.covers(revolving, [revolves]))).toEqual(
				new Tale.Uncovered({ missing: ['Rejection.Stuck'] })
			);
		})
	);

	it.effect('counts no tale of another subject, even one with the same case names', () =>
		Effect.gen(function* () {
			const twin = Decider.make(doorRules);
			expect(
				yield* Effect.flip(
					Tale.covers(door, [Exploration.decisions('the twin swings', twin, { runs: 5 })])
				)
			).toEqual(
				new Tale.Uncovered({
					missing: ['State.Open', 'State.Closed', 'Command.Push', 'Event.Swung', 'Rejection.Stuck']
				})
			);
		})
	);

	it.effect('passes when the tales touch every case together', () =>
		Effect.gen(function* () {
			const counted = Story.make(
				'the lamp logs nothing',
				Lamp.variant((current, message) => ({
					model: Lamp.lamp.update(current, message).model,
					commands: [Lamp.Log.make({ text: 'switched' })]
				})),
				lamp.given(Lamp.off),
				lamp.send(Lamp.switched()),
				lamp.resolve(Lamp.Log.make({ text: 'switched' }))
			);
			yield* Tale.covers(counted.program, [counted]);
		})
	);

	it.effect('names the cases no tale touches', () =>
		Effect.gen(function* () {
			const answers = Story.make(
				'a question is answered',
				chat,
				story.given(ready(1)),
				story.send(asked),
				story.resolve(ask, Answered.make({ turn: 't1', left: 0 })),
				story.resolve(saved)
			);
			const uncovered = yield* Effect.flip(Tale.covers(chat, [stops, answers]));
			expect(uncovered._tag).toBe('Uncovered');
			expect(uncovered.message).toBe(
				'no tale touches Model.Limited, Model.SignedOut, Message.Delta, Message.Refused'
			);
			expect(yield* Effect.flip(Tale.covers(Lamp.lamp, [switches]))).toEqual(
				new Tale.Uncovered({ missing: ['Command.Log'] })
			);
		})
	);
});

const Stock = Schema.Struct({ count: Schema.Int, limit: Schema.Int });
const Restock = Schema.TaggedUnion({ Restock: {} });
const Restocked = Schema.TaggedUnion({ Restocked: {} });

const stockRules = {
	State: Stock,
	Command: Restock,
	Event: Restocked,
	Rejection: Stuck,
	initial: { count: 0, limit: 10 },
	decide: { Restock: () => Result.succeed([Restocked.cases.Restocked.make({})]) },
	evolve: (current: typeof Stock.Type) => ({ ...current, count: current.limit })
};

const stock = Decider.make({
	...stockRules,
	invariants: {
		notNegative: (current) => current.count >= 0,
		withinLimit: (current) => current.count <= current.limit
	}
});

const short = { count: -1, limit: 10 };
const over = { count: 11, limit: 10 };

describe('Tale.breaks', () => {
	it.effect('passes when each state breaks its invariant alone', () =>
		Effect.gen(function* () {
			yield* Tale.breaks(stock, { notNegative: short, withinLimit: over });
			yield* Tale.breaks(Lamp.lamp, { countIsSmall: { ...Lamp.off, count: 10 } });
			yield* Tale.breaks(door, {});
		})
	);

	it.effect('fails when a state keeps its invariant', () =>
		Effect.gen(function* () {
			const kept = yield* Effect.flip(Tale.breaks(Lamp.lamp, { countIsSmall: Lamp.off }));
			expect(kept).toEqual(
				new Tale.Unbroken({
					invariant: 'countIsSmall',
					problem: 'the model holds it',
					actual: '{"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}'
				})
			);
			expect(kept.message).toBe(
				[
					'breaking invariant countIsSmall: the model holds it',
					'actual: {"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}'
				].join('\n')
			);
			expect(
				yield* Effect.flip(Tale.breaks(stock, { notNegative: short, withinLimit: short }))
			).toEqual(
				new Tale.Unbroken({
					invariant: 'withinLimit',
					problem: 'the state holds it',
					actual: '{"count":-1,"limit":10}'
				})
			);
		})
	);

	it.effect('fails when a state breaks other invariants too', () =>
		Effect.gen(function* () {
			const both = { count: -1, limit: -2 };
			const failure = yield* Effect.flip(
				Tale.breaks(stock, { notNegative: both, withinLimit: over })
			);
			expect(failure).toEqual(
				new Tale.Unbroken({
					invariant: 'notNegative',
					problem: 'the state breaks withinLimit too',
					actual: '{"count":-1,"limit":-2}'
				})
			);
			const third = Decider.make({
				...stockRules,
				invariants: { ...stock.invariants, owesNothing: (current) => current.limit >= 0 }
			});
			expect(
				(yield* Effect.flip(
					Tale.breaks(third, {
						notNegative: both,
						withinLimit: over,
						owesNothing: { count: 0, limit: -1 }
					})
				)).problem
			).toBe('the state breaks withinLimit, owesNothing too');
		})
	);

	it.effect('fails on an invalid state, and on an invariant without one', () =>
		Effect.gen(function* () {
			const invalid = yield* Effect.flip(
				Tale.breaks(stock, { notNegative: { count: -0.5, limit: 10 }, withinLimit: over })
			);
			expect(invalid.invariant).toBe('notNegative');
			expect(invalid.problem).toMatch(/^the state is invalid: /);
			// Typed without its invariant names, a Decider takes any states.
			const widened: Decider.Decider<
				typeof Stock.Type,
				typeof Restock.Type,
				typeof Restocked.Type,
				typeof Stuck.Type
			> = stock;
			const widenedLamp: Program.Program<Lamp.Lamp, Lamp.Message, Lamp.Command> = Lamp.lamp;
			expect(
				yield* Tale.breaks(widened, { notNegative: short }).pipe(
					Effect.catchTag('Unbroken', Effect.succeed)
				)
			).toMatchObject({ invariant: 'withinLimit', problem: 'no state given' });
			expect((yield* Effect.flip(Tale.breaks(widenedLamp, {}))).message).toBe(
				'breaking invariant countIsSmall: no model given'
			);
		})
	);

	it.effect('fails when an invariant throws or changes the state', () =>
		Effect.gen(function* () {
			const throwing = Decider.make({
				...stockRules,
				invariants: {
					notNegative: (current) => {
						if (current.limit > 10) throw new Error('too big');
						return current.count >= 0;
					}
				}
			});
			expect(
				yield* Effect.flip(Tale.breaks(throwing, { notNegative: { count: -1, limit: 11 } }))
			).toMatchObject({
				invariant: 'notNegative',
				problem: 'invariant notNegative threw: Error: too big'
			});
			const changing = Decider.make({
				...stockRules,
				invariants: {
					notNegative: (current) => !Object.assign(current, { count: 0 })
				}
			});
			expect((yield* Effect.flip(Tale.breaks(changing, { notNegative: short }))).problem).toBe(
				'invariant notNegative changed its input'
			);
		})
	);

	it('types the states by the invariants, one for each', () => {
		expectTypeOf<keyof typeof stock.invariants>().toEqualTypeOf<'notNegative' | 'withinLimit'>();
		expectTypeOf<keyof typeof door.invariants>().toEqualTypeOf<string>();
		// Given type arguments, the names default to `string`, and invariants are still predicates.
		const explicit = Program.make<Lamp.Lamp, Lamp.Message, Lamp.Command>({
			...Lamp.lamp,
			invariants: { notNegative: (model) => model.count >= 0 }
		});
		expectTypeOf<keyof typeof explicit.invariants>().toEqualTypeOf<string>();
		void Decider.make<
			typeof Stock.Type,
			typeof Restock.Type,
			typeof Restocked.Type,
			typeof Stuck.Type,
			typeof stockRules.decide
			// @ts-expect-error -- an invariant is a predicate
		>({ ...stockRules, invariants: { notNegative: 42 } });
		// @ts-expect-error -- withinLimit has no state
		void Tale.breaks(stock, { notNegative: short });
		// @ts-expect-error -- no invariant is called other
		void Tale.breaks(stock, { notNegative: short, withinLimit: over, other: over });
		// @ts-expect-error -- a lamp is no stock
		void Tale.breaks(stock, { notNegative: Lamp.off, withinLimit: over });
	});
});
