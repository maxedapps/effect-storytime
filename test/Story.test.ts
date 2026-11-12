import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Schema, SchemaTransformation } from 'effect';
import { Program } from 'effect-storytime';
import { Exploration, Story } from 'effect-storytime/testing';
import { Chat, chat, Command, Message, ready } from './examples/chat.ts';
import * as Conversation from './examples/conversation.ts';
import * as Lamp from './examples/lamp.ts';

const { Asked, Delta, Answered, Stopped } = Message.cases;
const { Ask, SaveTurn } = Command.cases;
const { given, send, model, satisfies, commands, resolve, emit, restart, anyOrder, steps } = Story;

const asked = Asked.make({ turn: 't1', text: 'Why Effect?' });
const ask = Ask.make({ turn: 't1', text: 'Why Effect?' });
const turn = { id: 't1', question: 'Why Effect?', answer: 'Typed errors.' };
const asking = Chat.cases.Asking.make({
	turns: [],
	left: 2,
	turn: 't1',
	question: 'Why Effect?',
	answer: ''
});

const answers = Story.make(
	'a question is answered in a stream and the turn is saved',
	chat,
	given(ready(2)),
	send(asked),
	commands(ask),
	emit(ask, Delta.make({ turn: 't1', text: 'Typed ' })),
	emit(ask, Delta.make({ turn: 't1', text: 'errors.' })),
	resolve(ask, Answered.make({ turn: 't1', left: 1 })),
	commands(SaveTurn.make(turn)),
	resolve(SaveTurn.make(turn)),
	model(Chat.cases.Ready.make({ turns: [turn], left: 1 })),
	satisfies('one question left', (current) => Chat.guards.Ready(current) && current.left === 1)
);

const step = (n: number) => Conversation.Command.cases.RunStep.make({ turn: 't1', step: n });

const resuming = (resume: (current: Lamp.Lamp) => Program.Next<Lamp.Lamp, Lamp.Command>) =>
	Program.make({
		Model: Lamp.Lamp,
		Message: Lamp.Message,
		Command: Lamp.Command,
		update: Lamp.lamp.update,
		resume
	});

const failure = <Model, Message extends Program.Tagged, Command extends Program.Tagged>(
	story: Story.Story<Model, Message, Command>
) => Effect.flip(Story.run(story));

describe('Story', () => {
	it.effect('runs a story and returns its final model and the cases it touched', () =>
		Effect.gen(function* () {
			const outcome = yield* Story.run(answers);
			expect(outcome.model).toEqual(Chat.cases.Ready.make({ turns: [turn], left: 1 }));
			expect(outcome.final).toBe(
				'Ready {"left":1,"turns":[{"answer":"Typed errors.","id":"t1","question":"Why Effect?"}]}'
			);
			expect(outcome.cases).toEqual([
				'Command.Ask',
				'Command.SaveTurn',
				'Message.Answered',
				'Message.Asked',
				'Message.Delta',
				'Model.Asking',
				'Model.Ready'
			]);
		})
	);

	it('renders a story as plain lines', () => {
		expect(Story.lines(answers)).toEqual([
			'given Ready {"left":2,"turns":[]}',
			'send Asked {"text":"Why Effect?","turn":"t1"}',
			'commands Ask {"text":"Why Effect?","turn":"t1"}',
			'emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"Typed ","turn":"t1"}',
			'emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"errors.","turn":"t1"}',
			'resolve Ask {"text":"Why Effect?","turn":"t1"} → Answered {"left":1,"turn":"t1"}',
			'commands SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
			'resolve SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
			'model Ready {"left":1,"turns":[{"answer":"Typed errors.","id":"t1","question":"Why Effect?"}]}',
			'satisfies one question left'
		]);
	});

	it('renders groups inline, orders indented and empty command sets', () => {
		const story = Story.make(
			'recall in any order',
			Conversation.conversation,
			given(Conversation.idle),
			steps(send(Conversation.Message.cases.Started.make({ turn: 't1' }))),
			anyOrder(
				send(Conversation.Message.cases.Recall.make({ turn: 't1' })),
				resolve(Conversation.Command.cases.RunStep.make({ turn: 't1', step: 0 }))
			),
			commands(),
			satisfies('recalled', Conversation.Phase.guards.Recalled),
			restart()
		);
		expect(Story.lines(story)).toEqual([
			'given Idle',
			'send Started {"turn":"t1"}',
			'any order',
			'  send Recall {"turn":"t1"}',
			'  resolve RunStep {"step":0,"turn":"t1"}',
			'commands none',
			'satisfies recalled',
			'restart'
		]);
	});

	describe('fails', () => {
		it.effect('a story that does not start with given', () =>
			Effect.gen(function* () {
				expect(yield* failure(Story.make('empty', chat))).toMatchObject({
					step: 1,
					line: '',
					message: 'a story starts with given(model)'
				});
				expect(yield* failure(Story.make('late', chat, send(asked)))).toMatchObject({
					step: 1,
					message: 'a story starts with given(model)'
				});
			})
		);

		it.effect('a second given', () =>
			Effect.gen(function* () {
				expect(
					yield* failure(Story.make('twice', chat, given(ready(1)), given(ready(2))))
				).toMatchObject({ step: 2, message: 'given(model) comes once, first' });
			})
		);

		it.effect('an anyOrder of fewer than 2 or more than 5 steps', () =>
			Effect.gen(function* () {
				const one = Story.make('one', chat, given(ready(1)), anyOrder(send(asked)));
				const six = Story.make(
					'six',
					chat,
					given(ready(1)),
					anyOrder(...Array.from({ length: 6 }, () => send<Chat, Message, Command>(asked)))
				);
				expect(yield* failure(one)).toMatchObject({
					step: 2,
					message: 'anyOrder takes 2 to 5 steps'
				});
				expect(yield* failure(six)).toMatchObject({ step: 2 });
				const five = Story.make(
					'five',
					Lamp.lamp,
					given(Lamp.off),
					anyOrder(
						...Array.from({ length: 5 }, () =>
							send<Lamp.Lamp, Lamp.Message, Lamp.Command>(Lamp.switched())
						)
					),
					model({ on: true, at: new Date('2026-11-04T00:00:00.000Z'), count: 5 })
				);
				yield* Story.run(five);
			})
		);

		it.effect('an invalid given model or message, checked on the Type side', () =>
			Effect.gen(function* () {
				const invalid = { ...Lamp.off, count: 0.5 };
				expect(yield* failure(Story.make('bad', Lamp.lamp, given(invalid)))).toMatchObject({
					step: 1,
					line: 'given {"at":"2026-11-03T00:00:00.000Z","count":0.5,"on":0}',
					message: 'the model is invalid: Expected an integer\n  at ["count"]'
				});
				const message = Lamp.Switched.make({ at: Lamp.off.at, by: 0.5 }, { disableChecks: true });
				expect(
					yield* failure(Story.make('bad', Lamp.lamp, given(Lamp.off), send(message)))
				).toMatchObject({
					step: 2,
					message: 'the message is invalid: Expected an integer\n  at ["by"]'
				});
			})
		);

		it.effect('a model that differs, with both sides for the diff', () =>
			Effect.gen(function* () {
				const story = Story.make('differs', chat, given(ready(2)), model(ready(1)));
				const error = yield* failure(story);
				expect(error._tag).toBe('StoryFailure');
				expect(error).toMatchObject({
					title: 'differs',
					step: 2,
					line: 'model Ready {"left":1,"turns":[]}',
					message: 'the model differs',
					expected: 'Ready {"left":1,"turns":[]}',
					actual: 'Ready {"left":2,"turns":[]}'
				});
			})
		);

		it.effect('a model that fails a check', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'check',
					chat,
					given(ready(2)),
					satisfies('asking', Chat.guards.Asking)
				);
				expect(yield* failure(story)).toMatchObject({
					step: 2,
					line: 'satisfies asking',
					message: 'the model does not satisfy asking',
					actual: 'Ready {"left":2,"turns":[]}'
				});
			})
		);

		it.effect('pending commands that differ from the expected ones', () =>
			Effect.gen(function* () {
				const missing = Story.make('missing', chat, given(ready(2)), send(asked), commands());
				expect(yield* failure(missing)).toMatchObject({
					step: 3,
					message: 'the pending commands differ',
					expected: '',
					actual: 'Ask {"text":"Why Effect?","turn":"t1"}'
				});
				const extra = Story.make(
					'extra',
					chat,
					given(ready(2)),
					commands(ask, SaveTurn.make(turn))
				);
				expect(yield* failure(extra)).toMatchObject({
					line: 'commands Ask {"text":"Why Effect?","turn":"t1"}, SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
					expected:
						'Ask {"text":"Why Effect?","turn":"t1"}\nSaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
					actual: ''
				});
			})
		);

		it.effect('resolving or emitting a command that is not pending', () =>
			Effect.gen(function* () {
				const resolved = Story.make(
					'resolve',
					chat,
					given(ready(2)),
					send(asked),
					commands(ask),
					resolve(SaveTurn.make(turn))
				);
				expect(yield* failure(resolved)).toMatchObject({
					step: 4,
					message:
						'SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"} is not pending',
					expected: 'SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
					actual: 'Ask {"text":"Why Effect?","turn":"t1"}'
				});
				const emitted = Story.make(
					'emit',
					chat,
					given(ready(2)),
					emit(ask, Delta.make({ turn: 't1', text: 'x' }))
				);
				expect(yield* failure(emitted)).toMatchObject({ step: 2 });
			})
		);

		it.effect('a command that no step asserted by the end', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'owed',
					chat,
					given(ready(2)),
					send(asked),
					resolve(ask, Answered.make({ turn: 't1', left: 1 })),
					send(Asked.make({ turn: 't2', text: 'And Schema?' }))
				);
				expect(yield* failure(story)).toMatchObject({
					step: 5,
					line: 'end',
					message: 'the story ended with 2 unasserted command(s)',
					actual:
						'Ask {"text":"And Schema?","turn":"t2"}\nSaveTurn {"answer":"","id":"t1","question":"Why Effect?"}'
				});
			})
		);

		it.effect('a command left owed while an emit asserts and a cancel drops another', () =>
			Effect.gen(function* () {
				const second = Ask.make({ turn: 't2', text: 'And Schema?' });
				const story = Story.make(
					'two at once',
					chat,
					given(ready(2)),
					send(asked),
					resolve(ask, Answered.make({ turn: 't1', left: 1 })),
					send(Asked.make({ turn: 't2', text: 'And Schema?' })),
					emit(second, Delta.make({ turn: 't2', text: 'Yes.' })),
					send(Stopped.make({}))
				);
				expect(yield* failure(story)).toMatchObject({
					line: 'end',
					message: 'the story ended with 1 unasserted command(s)',
					actual: 'SaveTurn {"answer":"","id":"t1","question":"Why Effect?"}'
				});
			})
		);

		it.effect('a cancel of a command no step asserted', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'cancelled',
					chat,
					given(ready(2)),
					send(asked),
					send(Stopped.make({}))
				);
				expect(yield* failure(story)).toMatchObject({
					step: 3,
					message:
						'Ask {"text":"Why Effect?","turn":"t1"} was cancelled before any step asserted it'
				});
			})
		);

		it.effect('a restart that drops a command no step asserted', () =>
			Effect.gen(function* () {
				const story = Story.make('restarted', chat, given(ready(2)), send(asked), restart());
				expect(yield* failure(story)).toMatchObject({
					step: 3,
					message: 'the restart drops commands no step asserted',
					actual: 'Ask {"text":"Why Effect?","turn":"t1"}'
				});
			})
		);

		it.effect('an update that throws', () =>
			Effect.gen(function* () {
				const broken = Lamp.variant(() => {
					throw new Error('no power');
				});
				const story = Story.make('throws', broken, given(Lamp.off), send(Lamp.switched()));
				expect(yield* failure(story)).toMatchObject({
					step: 2,
					message: 'update threw: Error: no power'
				});
			})
		);

		it.effect(
			'an update that mutates its input, even inside a Date, leaving the story intact',
			() =>
				Effect.gen(function* () {
					const mutating = Lamp.variant((lamp, message) => {
						lamp.at.setUTCDate(lamp.at.getUTCDate() + 1);
						message.at.setUTCDate(message.at.getUTCDate() + 1);
						return { model: lamp };
					});
					const story = Story.make('mutates', mutating, given(Lamp.off), send(Lamp.switched()));
					const before = Story.lines(story);
					expect(yield* failure(story)).toMatchObject({
						step: 2,
						message: 'update changed its input'
					});
					expect(Story.lines(story)).toEqual(before);
				})
		);

		it.effect('an update that mutates a model it shares with the story', () =>
			Effect.gen(function* () {
				const shared = { ...Lamp.off, on: true };
				const sharing = Lamp.variant((lamp, message) => {
					if (message.by === 1) return { model: shared };
					Object.assign(lamp, { count: 5 });
					return { model: lamp };
				});
				const story = Story.make(
					'shares',
					sharing,
					given(Lamp.off),
					send(Lamp.switched(1)),
					send(Lamp.switched(2)),
					model(shared)
				);
				const before = Story.lines(story);
				expect(yield* failure(story)).toMatchObject({
					step: 3,
					message: 'update changed its input'
				});
				expect(Story.lines(story)).toEqual(before);
				expect(shared).toEqual({ ...Lamp.off, on: true });
			})
		);

		it.effect('an update that gives another result for the same input', () =>
			Effect.gen(function* () {
				let calls = 0;
				const drifting = Lamp.variant((lamp) => {
					calls += 1;
					return { model: { ...lamp, count: calls } };
				});
				const story = Story.make('drifts', drifting, given(Lamp.off), send(Lamp.switched()));
				expect(yield* failure(story)).toMatchObject({
					step: 2,
					message: 'update gave two results for the same input'
				});
			})
		);

		it.effect('an update that returns an invalid model or command', () =>
			Effect.gen(function* () {
				const halves = Lamp.variant((lamp) => ({ model: { ...lamp, count: 0.5 } }));
				expect(
					yield* failure(Story.make('model', halves, given(Lamp.off), send(Lamp.switched())))
				).toMatchObject({
					step: 2,
					message: 'the model is invalid: Expected an integer\n  at ["count"]'
				});
				const blank = Lamp.variant((lamp) => ({
					model: lamp,
					commands: [Lamp.Log.make({ text: '' }, { disableChecks: true })]
				}));
				expect(
					yield* failure(Story.make('command', blank, given(Lamp.off), send(Lamp.switched())))
				).toMatchObject({
					step: 2,
					message:
						'the command is invalid: Expected a value with a length of at least 1\n  at ["text"]'
				});
			})
		);

		it.effect('a model that does not survive JSON, shown as the reason', () =>
			Effect.gen(function* () {
				const opaque = Program.make({
					Model: Schema.Struct({ value: Schema.Unknown }),
					Message: Lamp.Message,
					Command: Lamp.Command,
					update: (current) => ({ model: current })
				});
				expect(yield* failure(Story.make('json', opaque, given({ value: 1n })))).toMatchObject({
					step: 1,
					line: 'given (not JSON: Expected JSON value at ["value"])',
					message: 'the model does not survive JSON: Expected JSON value\n  at ["value"]'
				});
				const producing = Program.make({ ...opaque, update: () => ({ model: { value: 1n } }) });
				const produced = yield* failure(
					Story.make('produced', producing, given({ value: 0 }), send(Lamp.switched()))
				);
				expect(produced).toBeInstanceOf(Story.StoryFailure);
				expect(produced).toMatchObject({
					step: 2,
					message: 'the model is not JSON: Expected JSON value\n  at ["value"]'
				});
				const explored = yield* Effect.flip(
					Exploration.check(
						Exploration.make('explored', producing, {
							given: Arbitrary.Constant({ value: 0 }),
							send: Arbitrary.Constant(Lamp.switched())
						})
					)
				);
				expect(explored).toMatchObject({
					message: produced.message,
					counterexample: [
						'given {"value":0}',
						'send Switched {"at":"2026-11-04T00:00:00.000Z","by":1}'
					]
				});
				expect(explored.replay).toBeTypeOf('string');
			})
		);

		it.effect('a model that changes through JSON', () =>
			Effect.gen(function* () {
				const trimmed = Program.make({
					Model: Schema.String.pipe(Schema.decode(SchemaTransformation.trim())),
					Message: Lamp.Message,
					Command: Lamp.Command,
					update: (current) => ({ model: current })
				});
				expect(yield* failure(Story.make('lossy', trimmed, given(' padded ')))).toMatchObject({
					step: 1,
					message: 'the model changes through JSON',
					expected: '" padded "',
					actual: '"padded"'
				});
			})
		);

		it.effect('a broken invariant, before and after a step', () =>
			Effect.gen(function* () {
				const big = { ...Lamp.off, count: 10 };
				expect(yield* failure(Story.make('given', Lamp.lamp, given(big)))).toMatchObject({
					step: 1,
					message: 'invariant countIsSmall does not hold',
					actual: '{"at":"2026-11-03T00:00:00.000Z","count":10,"on":0}'
				});
				expect(
					yield* failure(Story.make('sent', Lamp.lamp, given(Lamp.off), send(Lamp.switched(10))))
				).toMatchObject({ step: 2, message: 'invariant countIsSmall does not hold' });
				const explosive = Program.make({
					Model: Lamp.Lamp,
					Message: Lamp.Message,
					Command: Lamp.Command,
					update: Lamp.lamp.update,
					invariants: {
						explodes: () => {
							throw new Error('boom');
						}
					}
				});
				expect(yield* failure(Story.make('throws', explosive, given(Lamp.off)))).toMatchObject({
					step: 1,
					message: 'invariant explodes threw: Error: boom'
				});
			})
		);
	});

	describe('commands', () => {
		const logged = Lamp.Log.make({ text: 'switched' });
		const by = Lamp.Log.make({ text: 'by 1' });

		it.effect('replace an identical pending one, and resolving one keeps the others', () =>
			Effect.gen(function* () {
				const logging = Lamp.variant((current, { at, by: amount }) => ({
					model: { ...current, at, count: current.count + amount },
					commands: [logged, Lamp.Log.make({ text: `by ${amount}` })]
				}));
				const story = Story.make(
					'logs',
					logging,
					given(Lamp.off),
					send(Lamp.switched()),
					send(Lamp.switched()),
					commands(by, logged),
					resolve(logged),
					commands(by)
				);
				yield* Story.run(story);
			})
		);

		it.effect('may cancel one that is not pending', () =>
			Effect.gen(function* () {
				const cancelling = Lamp.variant((current) => ({ model: current, cancels: [logged] }));
				yield* Story.run(Story.make('cancels', cancelling, given(Lamp.off), send(Lamp.switched())));
			})
		);
	});

	it.effect('starts from a given inside a leading group', () =>
		Effect.gen(function* () {
			const story = Story.make('grouped', chat, steps(given(ready(1)), model(ready(1))));
			expect((yield* Story.run(story)).model).toEqual(ready(1));
		})
	);

	it.effect('accepts a codec model given and checked by its typed values', () =>
		Effect.gen(function* () {
			const story = Story.make(
				'switches',
				Lamp.lamp,
				given(Lamp.off),
				send(Lamp.switched()),
				model({ on: true, at: new Date('2026-11-04T00:00:00.000Z'), count: 1 })
			);
			expect((yield* Story.run(story)).cases).toEqual(['Message.Switched']);
		})
	);

	describe('restart', () => {
		it.effect('fails a resume that throws or mutates the stored model', () =>
			Effect.gen(function* () {
				const throwing = resuming(() => {
					throw new Error('no disk');
				});
				expect(
					yield* failure(Story.make('throws', throwing, given(Lamp.off), restart()))
				).toMatchObject({
					step: 2,
					line: 'restart',
					message: 'resume threw: Error: no disk'
				});
				const mutating = resuming((current) => {
					current.at.setUTCDate(current.at.getUTCDate() + 1);
					return { model: current };
				});
				expect(
					yield* failure(Story.make('mutates', mutating, given(Lamp.off), restart()))
				).toMatchObject({
					step: 2,
					message: 'resume changed its input'
				});
			})
		);

		const { Started, StepDone } = Conversation.Message.cases;

		it.effect('round-trips the model, drops pending commands and resumes', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a restart redoes the running step',
					Conversation.conversation,
					given(Conversation.idle),
					send(Started.make({ turn: 't1' })),
					commands(step(0)),
					resolve(step(0), StepDone.make({ turn: 't1', step: 0, output: 'a', last: false })),
					commands(step(1)),
					restart(),
					commands(step(1)),
					resolve(step(1), StepDone.make({ turn: 't1', step: 1, output: 'b', last: true })),
					model(Conversation.Phase.cases.Done.make({ turn: 't1', output: 'ab' }))
				);
				expect((yield* Story.run(story)).model).toEqual(
					Conversation.Phase.cases.Done.make({ turn: 't1', output: 'ab' })
				);
			})
		);

		it.effect('replaces the dropped commands with those resume asks for', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'dropped',
					Conversation.conversation,
					given(Conversation.idle),
					send(Started.make({ turn: 't1' })),
					commands(step(0)),
					restart(),
					resolve(step(0)),
					resolve(step(0))
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					message: 'RunStep {"step":0,"turn":"t1"} is not pending'
				});
			})
		);

		it.effect('uses the default resume, which keeps the model and starts nothing', () =>
			Effect.gen(function* () {
				const story = Story.make('lamp', Lamp.lamp, given(Lamp.off), restart(), model(Lamp.off));
				expect((yield* Story.run(story)).model).toEqual(Lamp.off);
			})
		);
	});

	describe('anyOrder', () => {
		const { Started, StepDone, Recall } = Conversation.Message.cases;
		const started = steps<Conversation.Phase, Conversation.Message, Conversation.Command>(
			send(Started.make({ turn: 't1' })),
			commands(step(0))
		);

		it.effect('permutes a group as one unit and names the order that failed', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a recall before the start does not stop it',
					Conversation.conversation,
					given(Conversation.idle),
					anyOrder(started, send(Recall.make({ turn: 't1' }))),
					model(Conversation.Phase.cases.Recalled.make({ turn: 't1' }))
				);
				expect(Story.lines(story)).toEqual([
					'given Idle',
					'any order',
					'  send Started {"turn":"t1"}',
					'  commands RunStep {"step":0,"turn":"t1"}',
					'  send Recall {"turn":"t1"}',
					'model Recalled {"turn":"t1"}'
				]);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					message: 'in order 5, 3, 4: the model differs',
					actual: 'Working {"output":"","step":0,"turn":"t1"}'
				});
			})
		);

		it.effect('skips a streamed message from a command cancelled before', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a stop wins over a late delta',
					chat,
					given(ready(2)),
					send(asked),
					commands(ask),
					anyOrder(send(Stopped.make({})), emit(ask, Delta.make({ turn: 't1', text: 'x' }))),
					model(ready(2)),
					commands()
				);
				yield* Story.run(story);
			})
		);

		it.effect('runs the rest once per order and skips replies to commands cancelled before', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a recall wins over the last step in either order',
					Conversation.conversation,
					given(Conversation.idle),
					started,
					anyOrder(
						send(Recall.make({ turn: 't1' })),
						resolve(step(0), StepDone.make({ turn: 't1', step: 0, output: 'a', last: true }))
					),
					model(Conversation.Phase.cases.Recalled.make({ turn: 't1' })),
					commands()
				);
				const outcome = yield* Story.run(story);
				expect(outcome.cases).toContain('Model.Done');
			})
		);

		it.effect('fails a command one order produced and a later step cancelled unasserted', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a recall also stops the next step',
					Conversation.conversation,
					given(Conversation.idle),
					started,
					anyOrder(
						resolve(step(0), StepDone.make({ turn: 't1', step: 0, output: 'a', last: false })),
						send(Recall.make({ turn: 't1' }))
					),
					commands()
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					message:
						'in order 5, 6: RunStep {"step":1,"turn":"t1"} was cancelled before any step asserted it'
				});
			})
		);

		it.effect('owes the steps after a group the commands produced before it', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a recall after the group stops an unasserted step',
					Conversation.conversation,
					given(Conversation.idle),
					send(Started.make({ turn: 't1' })),
					anyOrder(
						satisfies('working', Conversation.Phase.guards.Working),
						model(Conversation.Phase.cases.Working.make({ turn: 't1', step: 0, output: '' }))
					),
					send(Recall.make({ turn: 't1' }))
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					message:
						'in order 4, 5: RunStep {"step":0,"turn":"t1"} was cancelled before any step asserted it'
				});
			})
		);

		it.effect('fails a reply to a command that completed, not cancelled, earlier', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'answered twice',
					Conversation.conversation,
					given(Conversation.idle),
					started,
					anyOrder(
						resolve(step(0), StepDone.make({ turn: 't1', step: 0, output: 'a', last: true })),
						resolve(step(0), StepDone.make({ turn: 't1', step: 0, output: 'b', last: true }))
					)
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					message: 'in order 5, 6: RunStep {"step":0,"turn":"t1"} is not pending'
				});
			})
		);

		it.effect('names the order that failed', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'order matters',
					Conversation.conversation,
					given(Conversation.idle),
					started,
					anyOrder(
						send(Recall.make({ turn: 't1' })),
						resolve(step(0), StepDone.make({ turn: 't1', step: 0, output: 'a', last: true }))
					),
					satisfies('done', Conversation.Phase.guards.Done)
				);
				expect(yield* failure(story)).toMatchObject({
					step: 7,
					message: 'in order 5, 6: the model does not satisfy done'
				});
			})
		);
	});

	it.effect('keeps an emitting command pending and asserted', () =>
		Effect.gen(function* () {
			const story = Story.make(
				'streaming',
				chat,
				given(ready(2)),
				send(asked),
				emit(ask, Delta.make({ turn: 't1', text: 'Typed' })),
				commands(ask),
				model({ ...asking, answer: 'Typed' })
			);
			yield* Story.run(story);
		})
	);
});
