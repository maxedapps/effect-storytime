import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect } from 'effect';
import { Decision, Exploration, Story, Vitest } from '../src/testing/index.ts';
import { chat, Command, Message, ready } from './examples/chat.ts';
import * as Lamp from './examples/lamp.ts';
import { membership, Memberships, none, NotActive, Revoke } from './examples/membership.ts';

const { Asked, Stopped } = Message.cases;
const ask = Command.cases.Ask.make({ turn: 't1', text: 'Why?' });

const stops = Story.make(
	'a question is stopped',
	chat,
	Story.given(ready(1)),
	Story.send(Asked.make({ turn: 't1', text: 'Why?' })),
	Story.commands(ask),
	Story.send(Stopped.make({}))
);

const forgets = Story.make(
	'a question is forgotten',
	chat,
	Story.given(ready(1)),
	Story.send(Asked.make({ turn: 't1', text: 'Why?' })),
	Story.commands()
);

const switches = Exploration.make('the lamp switches', Lamp.lamp, {
	given: Arbitrary.Constant(Lamp.off),
	send: Arbitrary.Constant(Lamp.switched()),
	restarts: false,
	runs: 3,
	steps: 5
});

const revokes = Decision.make(
	'only an active membership is revoked',
	membership,
	Decision.given(none),
	Decision.when(Revoke.make({})),
	Decision.rejected(NotActive.make({}))
);

const logs = Lamp.variant((current, message) => ({
	model: Lamp.lamp.update(current, message).model,
	commands: [Lamp.Log.make({ text: 'switched' })]
}));

describe('stories and covers', () => {
	Vitest.stories(stops, switches, revokes);
	Vitest.covers(logs, [
		Story.make(
			'the lamp logs a switch',
			logs,
			Story.given(Lamp.off),
			Story.send(Lamp.switched()),
			Story.resolve(Lamp.Log.make({ text: 'switched' }))
		)
	]);

	it('register one test per tale and one for the cases', (ctx) => {
		expect(ctx.task.suite?.tasks.map((task) => task.name)).toEqual([
			'a question is stopped',
			'the lamp switches',
			'only an active membership is revoked',
			'its tales touch every case',
			'register one test per tale and one for the cases'
		]);
	});
});

describe('tell', () => {
	it.effect('records each tale it tells in the test meta', (ctx) =>
		Effect.gen(function* () {
			yield* Vitest.tell(ctx, stops);
			yield* Vitest.tell(ctx, switches);
			expect(ctx.task.meta.storytime).toEqual([
				{
					kind: 'Story',
					title: 'a question is stopped',
					lines: Story.lines(stops),
					status: 'passed',
					final: 'Ready {"left":1,"turns":[]}',
					cases: ['Command.Ask', 'Message.Asked', 'Message.Stopped', 'Model.Asking', 'Model.Ready']
				},
				{
					kind: 'Exploration',
					title: 'the lamp switches',
					lines: ['explore 3 runs of up to 5 steps, seed "the lamp switches"'],
					status: 'passed',
					final: undefined,
					cases: ['Message.Switched']
				}
			]);
		})
	);

	it.effect('records where a story failed and fails the test', (ctx) =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(Vitest.tell(ctx, forgets));
			expect(failure).toBeInstanceOf(Story.StoryFailure);
			expect(ctx.task.meta.storytime).toEqual([
				{
					kind: 'Story',
					title: 'a question is forgotten',
					lines: Story.lines(forgets),
					status: 'failed',
					failure: {
						step: 3,
						line: 'commands none',
						message: 'the pending commands differ',
						expected: '',
						actual: 'Ask {"text":"Why?","turn":"t1"}',
						counterexample: undefined,
						replay: undefined
					}
				}
			]);
		})
	);

	it.effect('records only the status when another error fails the run', (ctx) =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(Vitest.tell(ctx, revokes, Effect.fail('the store is down')))).toBe(
				'the store is down'
			);
			expect(ctx.task.meta.storytime).toEqual([
				{
					kind: 'Decision',
					title: 'only an active membership is revoked',
					lines: Decision.lines(revokes),
					status: 'failed',
					failure: undefined
				}
			]);
		})
	);

	it.effect('records a decision run against its store', (ctx) =>
		Effect.gen(function* () {
			yield* Vitest.tell(ctx, revokes, Decision.against(revokes, Memberships, 'u1'));
			expect(ctx.task.meta.storytime).toEqual([
				{
					kind: 'Decision',
					title: 'only an active membership is revoked',
					lines: Decision.lines(revokes),
					status: 'passed',
					final: '{"active":0,"checkedAt":null,"source":"teachable"}',
					cases: ['Command.Revoke', 'Rejection.NotActive']
				}
			]);
		}).pipe(Effect.provide(Memberships.layer))
	);
});
