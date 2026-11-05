import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Result, Schema } from 'effect';
import { Decider, Decision, Exploration, Story, Tale } from '../src/index.ts';
import { chat, Command, Message, ready } from './examples/chat.ts';
import * as Lamp from './examples/lamp.ts';
import { membership, none, NotActive, Revoke } from './examples/membership.ts';

const { Asked, Answered, Stopped } = Message.cases;
const { Ask, SaveTurn } = Command.cases;

const asked = Asked.make({ turn: 't1', text: 'Why?' });
const ask = Ask.make({ turn: 't1', text: 'Why?' });
const saved = SaveTurn.make({ id: 't1', question: 'Why?', answer: '' });

const stops = Story.make(
	'a question is stopped',
	chat,
	Story.given(ready(1)),
	Story.send(asked),
	Story.commands(ask),
	Story.send(Stopped.make({}))
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

const door = Decider.make({
	State: Door,
	Input: Push,
	Event: Swung,
	Rejection: Stuck,
	initial: Door.cases.Closed.make({}),
	decide: () => Result.succeed([Swung.cases.Swung.make({})]),
	evolve: (current) =>
		Door.guards.Open(current) ? Door.cases.Closed.make({}) : Door.cases.Open.make({})
});

const swings = Exploration.decisions('the door swings', door, { runs: 5 });

const revokes = Decision.make(
	'only an active membership is revoked',
	membership,
	Decision.given(none),
	Decision.when(Revoke.make({})),
	Decision.rejected(NotActive.make({}))
);

describe('Tale', () => {
	it.effect('renders and runs a story, an exploration and a decision alike', () =>
		Effect.gen(function* () {
			expect(Tale.lines(stops)).toEqual(Story.lines(stops));
			expect(yield* Tale.run(stops)).toEqual(yield* Story.run(stops));
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
			'Input.Grant',
			'Input.Check',
			'Input.Revoke',
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
			'Input.Push',
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
						'Input.Grant',
						'Input.Check',
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

	it.effect('passes when the tales touch every case together', () =>
		Effect.gen(function* () {
			const counted = Story.make(
				'the lamp logs nothing',
				Lamp.variant((current, message) => ({
					model: Lamp.lamp.update(current, message).model,
					commands: [Lamp.Log.make({ text: 'switched' })]
				})),
				Story.given(Lamp.off),
				Story.send(Lamp.switched()),
				Story.resolve(Lamp.Log.make({ text: 'switched' }))
			);
			yield* Tale.covers(counted.program, [counted]);
		})
	);

	it.effect('names the cases no tale touches', () =>
		Effect.gen(function* () {
			const answers = Story.make(
				'a question is answered',
				chat,
				Story.given(ready(1)),
				Story.send(asked),
				Story.resolve(ask, Answered.make({ turn: 't1', left: 0 })),
				Story.resolve(saved)
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
