import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Schema } from 'effect';
import { Exploration, Program, Story } from '../src/index.ts';
import { Chat, chat, Command, Message, ready } from './examples/chat.ts';
import * as Lamp from './examples/lamp.ts';

const { Asked, Delta, Answered, Refused, Stopped } = Message.cases;

const off = Arbitrary.Constant(Lamp.off);
const switches = Arbitrary.map(Arbitrary.schema(Schema.Int), Lamp.switched);
const given = 'given {"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}';
const sent = (by: number) => `send Switched {"at":"2026-11-04T00:00:00.000Z","by":${by}}`;

const counts = Exploration.make('the lamp counts switches', Lamp.lamp, {
	given: off,
	send: switches
});

/** The chat's own questions, answers and refusals, so turns match the pending ask. */
const talks = (program: Program.Program<Chat, Message, Command>, runs = 100) =>
	Exploration.make('a chat talks', program, {
		runs,
		given: Arbitrary.Constant(ready(2)),
		send: Arbitrary.map(Arbitrary.schema(Schema.Literals(['t1', 't2', 'stop'])), (turn): Message =>
			turn === 'stop' ? Stopped.make({}) : Asked.make({ turn, text: `question ${turn}` })
		),
		replies: (command) =>
			Command.guards.Ask(command)
				? [
						Answered.make({ turn: command.turn, left: 1 }),
						Refused.make({ turn: command.turn, reason: 'Busy' }),
						Refused.make({ turn: command.turn, reason: 'SignedOut' })
					]
				: [],
		emits: (command) =>
			Command.guards.Ask(command) ? [Delta.make({ turn: command.turn, text: 'hi' })] : []
	});

const resuming = (resume: (current: Lamp.Lamp) => Program.Next<Lamp.Lamp, Lamp.Command>) =>
	Program.make({
		Model: Lamp.Lamp,
		Message: Lamp.Message,
		Command: Lamp.Command,
		update: Lamp.lamp.update,
		resume,
		invariants: Lamp.lamp.invariants
	});

describe('Exploration', () => {
	it('renders as one line naming its runs, steps, seed and restarts', () => {
		expect(Exploration.lines(counts)).toEqual([
			'explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts'
		]);
		expect(
			Exploration.lines(
				Exploration.make('few', Lamp.lamp, {
					given: off,
					restarts: false,
					runs: 5,
					steps: 3,
					seed: 7
				})
			)
		).toEqual(['explore 5 runs of up to 3 steps, seed 7']);
	});

	it.effect('shrinks a broken invariant to the shortest story that breaks it', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(Exploration.check(counts));
			expect(failure).toEqual(
				new Story.StoryFailure({
					title: 'the lamp counts switches',
					step: 2,
					line: Exploration.lines(counts)[0] ?? '',
					message: 'invariant countIsSmall does not hold',
					expected: undefined,
					actual: '{"at":"2026-11-04T00:00:00.000Z","count":10,"on":1}',
					counterexample: [given, sent(10)],
					replay: failure.replay ?? ''
				})
			);
		})
	);

	it.effect('replays a failure from its token alone', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(Exploration.check(counts));
			const replayed = yield* Effect.flip(
				Exploration.check(
					Exploration.make('replayed', Lamp.lamp, { given: off, send: switches, seed: 1 }),
					{
						replay: failure.replay ?? ''
					}
				)
			);
			expect(replayed.counterexample).toEqual([given, sent(10)]);
			expect(replayed.replay).toBe(failure.replay);
		})
	);

	it.effect('fails a replay that no longer fails', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(Exploration.check(counts));
			const fixed = Exploration.make('fixed', Lamp.variant(Lamp.lamp.update), {
				given: off,
				send: switches
			});
			expect(
				yield* Effect.flip(Exploration.check(fixed, { replay: failure.replay ?? '' }))
			).toEqual(
				new Story.StoryFailure({
					title: 'fixed',
					step: 1,
					line: 'explore 100 runs of up to 30 steps, seed "fixed", with restarts',
					message: 'Property replay failed: PropertyPassed'
				})
			);
		})
	);

	it.effect('shrinks a throwing update too', () =>
		Effect.gen(function* () {
			const throwing = Lamp.variant((current, message) => {
				if (message.by === 3) throw new Error('three');
				return Lamp.lamp.update(current, message);
			});
			const failure = yield* Effect.flip(
				Exploration.check(Exploration.make('throws', throwing, { given: off, send: switches }))
			);
			expect(failure.message).toBe('update threw: Error: three');
			expect(failure.counterexample).toEqual([given, sent(3)]);
		})
	);

	it.effect('fails at the given when the start is invalid', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				Exploration.check(
					Exploration.make('starts wrong', Lamp.lamp, {
						given: Arbitrary.Constant({ ...Lamp.off, count: 10 }),
						send: switches
					})
				)
			);
			expect(failure.step).toBe(1);
			expect(failure.message).toBe('invariant countIsSmall does not hold');
		})
	);

	it.effect('restarts paths only when asked', () =>
		Effect.gen(function* () {
			const broken = resuming((current) => ({ model: { ...current, count: 10 } }));
			const failure = yield* Effect.flip(
				Exploration.check(Exploration.make('restarts', broken, { given: off, send: switches }))
			);
			expect(failure.counterexample).toEqual([given, 'restart']);
			expect(
				yield* Exploration.check(
					Exploration.make('stays up', broken, {
						given: off,
						send: Arbitrary.Constant(Lamp.switched()),
						restarts: false,
						steps: 5
					})
				)
			).toEqual({ runs: 100, cases: ['Message.Switched'] });
		})
	);

	it.effect('fails when the generators discard too many paths', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				Exploration.check(
					Exploration.make('nothing', Lamp.lamp, {
						given: Arbitrary.filter(off, () => false),
						runs: 1
					})
				)
			);
			expect(failure.message).toMatch(/^Property exhausted after 0 run\(s\)/);
		})
	);

	it.effect('answers pending commands with their replies and streams', () =>
		Effect.gen(function* () {
			expect(yield* Exploration.check(talks(chat))).toEqual({
				runs: 100,
				cases: [
					'Command.Ask',
					'Command.SaveTurn',
					'Message.Answered',
					'Message.Asked',
					'Message.Delta',
					'Message.Refused',
					'Message.Stopped',
					'Model.Asking',
					'Model.Ready',
					'Model.SignedOut'
				]
			});
		})
	);

	it.effect('finds a broken rule several answers deep', () =>
		Effect.gen(function* () {
			const strict = Program.make({
				...chat,
				invariants: {
					onlyFirstAnswersStream: (current) =>
						!Chat.guards.Asking(current) || current.turns.length === 0 || current.answer === ''
				}
			});
			const failure = yield* Effect.flip(Exploration.check(talks(strict, 400)));
			expect(failure.step).toBe(5);
			expect(failure.counterexample).toEqual([
				'given Ready {"left":2,"turns":[]}',
				'send Asked {"text":"question t2","turn":"t2"}',
				'resolve Ask {"text":"question t2","turn":"t2"} → Answered {"left":1,"turn":"t2"}',
				'send Asked {"text":"question t1","turn":"t1"}',
				'emit Ask {"text":"question t1","turn":"t1"} → Delta {"text":"hi","turn":"t1"}'
			]);
		})
	);

	it.effect('sends any message the Message Schema allows by default', () =>
		Effect.gen(function* () {
			expect(
				yield* Exploration.check(
					Exploration.make('random chat', chat, { given: Arbitrary.Constant(ready(2)) })
				)
			).toEqual({
				runs: 100,
				cases: [
					'Command.Ask',
					'Message.Answered',
					'Message.Asked',
					'Message.Delta',
					'Message.Refused',
					'Message.Stopped',
					'Model.Asking',
					'Model.Ready',
					'Model.SignedOut'
				]
			});
		})
	);
});
