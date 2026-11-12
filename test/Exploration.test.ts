import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Result, Schema } from 'effect';
import { Decider, Program } from 'effect-storytime';
import { Exploration, Story } from 'effect-storytime/testing';
import { Chat, chat, Command, Message, ready } from './examples/chat.ts';
import * as Lamp from './examples/lamp.ts';
import {
	at,
	Grant,
	Command as MembershipCommand,
	membership,
	Revoke,
	variant
} from './examples/membership.ts';

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

	it.effect('shows and replays the start an update mutated as it was given', () =>
		Effect.gen(function* () {
			const mutating = Lamp.variant((lamp) => {
				Object.assign(lamp, { count: lamp.count + 1 });
				return { model: lamp };
			});
			const mutates = Exploration.make('mutates', mutating, { given: off, send: switches });
			const failure = yield* Effect.flip(Exploration.check(mutates));
			expect(failure.message).toBe('update changed its input');
			expect(failure.counterexample?.[0]).toBe(given);
			const replayed = yield* Effect.flip(
				Exploration.check(mutates, { replay: failure.replay ?? '' })
			);
			expect(replayed.counterexample).toEqual(failure.counterexample);
		})
	);

	it.effect('keeps a nested start apart from the model an update mutates', () =>
		Effect.gen(function* () {
			const nested = Program.make({
				Model: Schema.Struct({ nested: Schema.Unknown }),
				Message: Lamp.Message,
				Command: Lamp.Command,
				update: (current) => {
					Object.assign(Object(current.nested), { count: 1 });
					return { model: current };
				}
			});
			const start = { nested: { count: 0 } };
			const mutates = Exploration.make('mutates deep', nested, {
				given: Arbitrary.Constant(start),
				send: switches
			});
			const failure = yield* Effect.flip(Exploration.check(mutates));
			expect(failure.message).toBe('update changed its input');
			expect(failure.counterexample?.[0]).toBe('given {"nested":{"count":0}}');
			expect(start).toEqual({ nested: { count: 0 } });
			const replayed = yield* Effect.flip(
				Exploration.check(mutates, { replay: failure.replay ?? '' })
			);
			expect(replayed.counterexample).toEqual(failure.counterexample);
		})
	);

	it.effect('answers with any reply, not just the first few', () =>
		Effect.gen(function* () {
			const Said = Schema.TaggedUnion({ Asked: {}, Replied: { n: Schema.Int } });
			const Asks = Schema.TaggedUnion({ Ask: {} });
			const picky = Program.make({
				Model: Schema.Struct({ last: Schema.Int }),
				Message: Said,
				Command: Asks,
				update: (current: { readonly last: number }, message: typeof Said.Type) =>
					Said.guards.Asked(message)
						? { model: current, commands: [Asks.cases.Ask.make({})] }
						: { model: { last: message.n } },
				invariants: { notTheNinth: (current) => current.last !== 8 }
			});
			const failure = yield* Effect.flip(
				Exploration.check(
					Exploration.make('a ninth reply', picky, {
						given: Arbitrary.Constant({ last: 0 }),
						send: Arbitrary.Constant(Said.cases.Asked.make({})),
						replies: () => Array.from({ length: 9 }, (_, n) => Said.cases.Replied.make({ n })),
						restarts: false
					})
				)
			);
			expect(failure.counterexample).toEqual([
				'given {"last":0}',
				'send Asked',
				'resolve Ask → Replied {"n":8}'
			]);
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
				'send Asked {"text":"question t1","turn":"t1"}',
				'resolve Ask {"text":"question t1","turn":"t1"} → Answered {"left":1,"turn":"t1"}',
				'send Asked {"text":"question t2","turn":"t2"}',
				'emit Ask {"text":"question t2","turn":"t2"} → Delta {"text":"hi","turn":"t2"}'
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

	it.effect('decides any command the Command Schema allows from the initial state by default', () =>
		Effect.gen(function* () {
			const explored = Exploration.decisions('memberships', membership);
			expect(Exploration.lines(explored)).toEqual([
				'explore 100 runs of up to 30 steps, seed "memberships"'
			]);
			expect(yield* Exploration.check(explored)).toEqual({
				runs: 100,
				cases: [
					'Command.Check',
					'Command.Grant',
					'Command.Revoke',
					'Event.Checked',
					'Event.Granted',
					'Event.Revoked',
					'Rejection.AlreadyActive',
					'Rejection.Manual',
					'Rejection.NotActive'
				]
			});
		})
	);

	it.effect('starts from the given states and decides the given commands', () =>
		Effect.gen(function* () {
			const revokes = Exploration.decisions('revokes', membership, {
				given: Arbitrary.Constant({ source: 'teachable', active: true, checkedAt: at }),
				when: Arbitrary.Constant(Revoke.make({})),
				runs: 3,
				steps: 5,
				seed: 2
			});
			expect(yield* Exploration.check(revokes)).toEqual({
				runs: 3,
				cases: ['Command.Revoke', 'Event.Revoked', 'Rejection.NotActive']
			});
		})
	);

	it.effect('shrinks a throwing decide to the shortest decision that throws', () =>
		Effect.gen(function* () {
			const throwing = variant((current, command) => {
				if (current.active && MembershipCommand.guards.Revoke(command)) throw new Error('revoked');
				return membership.decide(current, command);
			});
			const failure = yield* Effect.flip(
				Exploration.check(
					Exploration.decisions('throws', throwing, {
						when: Arbitrary.map(Arbitrary.schema(Schema.Boolean), (grants) =>
							grants ? Grant.make({ source: 'teachable', at }) : Revoke.make({})
						)
					})
				)
			);
			expect(failure).toEqual(
				new Story.StoryFailure({
					title: 'throws',
					step: 3,
					line: 'explore 100 runs of up to 30 steps, seed "throws"',
					message: 'decide threw: Error: revoked',
					expected: undefined,
					actual: undefined,
					counterexample: [
						'given {"active":0,"checkedAt":null,"source":"teachable"}',
						'when Grant {"at":"2026-11-03T00:00:00.000Z","source":"teachable"}',
						'when Revoke'
					],
					replay: failure.replay ?? ''
				})
			);
		})
	);

	it.effect('touches the case of a start state that decides nothing', () =>
		Effect.gen(function* () {
			const Door = Schema.TaggedUnion({ Open: {}, Closed: {} });
			const Push = Schema.TaggedUnion({ Push: {} });
			const door = Decider.make({
				State: Door,
				Command: Push,
				Event: Push,
				Rejection: Push,
				initial: Door.cases.Closed.make({}),
				decide: () => Result.succeed([]),
				evolve: (current) => current
			});
			expect(
				yield* Exploration.check(Exploration.decisions('a door', door, { runs: 3, steps: 0 }))
			).toEqual({ runs: 3, cases: ['State.Closed'] });
		})
	);

	it.effect('fails a given state that breaks an invariant at its first line', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				Exploration.check(
					Exploration.decisions('unchecked', membership, {
						given: Arbitrary.Constant({ source: 'teachable', active: true, checkedAt: null })
					})
				)
			);
			expect(failure.step).toBe(1);
			expect(failure.message).toBe('invariant checkedWhenActive does not hold');
			expect(failure.counterexample).toEqual([
				'given {"active":1,"checkedAt":null,"source":"teachable"}'
			]);
		})
	);
});
