import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Schema, SchemaTransformation } from 'effect';
import { Program } from 'effect-storytime';
import { Exploration, Story } from 'effect-storytime/testing';
import { Chat, chat, Command, Message, ready } from './examples/chat.ts';
import * as Conversation from './examples/conversation.ts';
import * as Lamp from './examples/lamp.ts';

const { Asked, Delta, Answered, Stopped } = Message.cases;
const { Ask, SaveTurn } = Command.cases;
const { given, send, model, satisfies, commands, resolve, emit, restart, anyOrder, steps } =
	Story.of(chat);
const conversation = Story.of(Conversation.conversation);
const lamp = Story.of(Lamp.lamp);

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
			expect(outcome.finals).toEqual([
				{
					order: [],
					model: Chat.cases.Ready.make({ turns: [turn], left: 1 }),
					final:
						'Ready {"left":1,"turns":[{"answer":"Typed errors.","id":"t1","question":"Why Effect?"}]}'
				}
			]);
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
			conversation.given(Conversation.idle),
			conversation.steps(
				conversation.send(Conversation.Message.cases.Started.make({ turn: 't1' }))
			),
			conversation.anyOrder(
				conversation.send(Conversation.Message.cases.Recall.make({ turn: 't1' })),
				conversation.resolve(Conversation.Command.cases.RunStep.make({ turn: 't1', step: 0 }))
			),
			conversation.commands(),
			conversation.satisfies('recalled', Conversation.Phase.guards.Recalled),
			conversation.restart()
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
					problem: 'a story starts with given(model)'
				});
				expect(yield* failure(Story.make('late', chat, send(asked)))).toMatchObject({
					step: 1,
					problem: 'a story starts with given(model)'
				});
			})
		);

		it.effect('a second given', () =>
			Effect.gen(function* () {
				expect(
					yield* failure(Story.make('twice', chat, given(ready(1)), given(ready(2))))
				).toMatchObject({ step: 2, problem: 'given(model) comes once, first' });
			})
		);

		it.effect('an anyOrder of fewer than 2 or more than 5 steps', () =>
			Effect.gen(function* () {
				const one = Story.make('one', chat, given(ready(1)), anyOrder(send(asked)));
				const six = Story.make(
					'six',
					chat,
					given(ready(1)),
					anyOrder(...Array.from({ length: 6 }, () => send(asked)))
				);
				expect(yield* failure(one)).toMatchObject({
					step: 2,
					problem: 'anyOrder takes 2 to 5 steps'
				});
				expect(yield* failure(six)).toMatchObject({ step: 2 });
				const five = Story.make(
					'five',
					Lamp.lamp,
					lamp.given(Lamp.off),
					lamp.anyOrder(...Array.from({ length: 5 }, () => lamp.send(Lamp.switched()))),
					lamp.model({ on: true, at: new Date('2026-11-04T00:00:00.000Z'), count: 5 })
				);
				yield* Story.run(five);
			})
		);

		it.effect('an invalid given model or message, checked on the Type side', () =>
			Effect.gen(function* () {
				const invalid = { ...Lamp.off, count: 0.5 };
				expect(yield* failure(Story.make('bad', Lamp.lamp, lamp.given(invalid)))).toMatchObject({
					step: 1,
					line: 'given {"at":"2026-11-03T00:00:00.000Z","count":0.5,"on":0}',
					problem: 'the model is invalid: Expected an integer\n  at ["count"]'
				});
				const message = Lamp.Switched.make({ at: Lamp.off.at, by: 0.5 }, { disableChecks: true });
				expect(
					yield* failure(Story.make('bad', Lamp.lamp, lamp.given(Lamp.off), lamp.send(message)))
				).toMatchObject({
					step: 2,
					problem: 'the message is invalid: Expected an integer\n  at ["by"]'
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
					problem: 'the model differs',
					expected: 'Ready {"left":1,"turns":[]}',
					actual: 'Ready {"left":2,"turns":[]}'
				});
				// The runner diffs the two sides, so the message leaves them out.
				expect(error.message).toBe('the model differs\nstep 2: model Ready {"left":1,"turns":[]}');
			})
		);

		it.effect('with a stack that starts where the story was made', () =>
			Effect.gen(function* () {
				const error = yield* failure(Story.make('differs', chat, given(ready(2)), model(ready(1))));
				// The message, then the frame of the Story.make call above.
				expect(error.stack).toMatch(
					/^StoryFailure: the model differs\nstep 2: model .*\n {4}at .*test\/Story\.test\.ts:\d+:\d+/
				);
				const direct = yield* failure(
					new Story.Story({ title: 'direct', program: chat, steps: [model(ready(1))] })
				);
				expect(direct.stack).toContain('src/testing/Story.ts');
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
					problem: 'the model does not satisfy asking',
					actual: 'Ready {"left":2,"turns":[]}'
				});
			})
		);

		it.effect('pending commands that differ from the expected ones', () =>
			Effect.gen(function* () {
				const missing = Story.make('missing', chat, given(ready(2)), send(asked), commands());
				expect(yield* failure(missing)).toMatchObject({
					step: 3,
					problem: 'the pending commands differ',
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
					problem:
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
					problem: 'the story ended with 2 unasserted command(s)',
					actual:
						'Ask {"text":"And Schema?","turn":"t2"}\nSaveTurn {"answer":"","id":"t1","question":"Why Effect?"}'
				});
				// With nothing to diff against, the message shows what is left.
				expect((yield* failure(story)).message).toBe(
					[
						'the story ended with 2 unasserted command(s)',
						'step 5: end',
						'actual: Ask {"text":"And Schema?","turn":"t2"}',
						'  SaveTurn {"answer":"","id":"t1","question":"Why Effect?"}'
					].join('\n')
				);
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
					problem: 'the story ended with 1 unasserted command(s)',
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
					problem:
						'Ask {"text":"Why Effect?","turn":"t1"} was cancelled before any step asserted it'
				});
			})
		);

		it.effect('a restart that drops a command no step asserted', () =>
			Effect.gen(function* () {
				const story = Story.make('restarted', chat, given(ready(2)), send(asked), restart());
				expect(yield* failure(story)).toMatchObject({
					step: 3,
					problem: 'the restart drops commands no step asserted',
					actual: 'Ask {"text":"Why Effect?","turn":"t1"}'
				});
			})
		);

		it.effect('an update that throws', () =>
			Effect.gen(function* () {
				const broken = Lamp.variant(() => {
					throw new Error('no power');
				});
				const story = Story.make(
					'throws',
					broken,
					lamp.given(Lamp.off),
					lamp.send(Lamp.switched())
				);
				expect(yield* failure(story)).toMatchObject({
					step: 2,
					problem: 'update threw: Error: no power'
				});
			})
		);

		it.effect(
			'an update that mutates its input, even inside a Date, leaving the story intact',
			() =>
				Effect.gen(function* () {
					const mutating = Lamp.variant((current, message) => {
						current.at.setUTCDate(current.at.getUTCDate() + 1);
						message.at.setUTCDate(message.at.getUTCDate() + 1);
						return { model: current };
					});
					const story = Story.make(
						'mutates',
						mutating,
						lamp.given(Lamp.off),
						lamp.send(Lamp.switched())
					);
					const before = Story.lines(story);
					expect(yield* failure(story)).toMatchObject({
						step: 2,
						problem: 'update changed its input'
					});
					expect(Story.lines(story)).toEqual(before);
				})
		);

		it.effect('an update that mutates a model it shares with the story', () =>
			Effect.gen(function* () {
				const shared = { ...Lamp.off, on: true };
				const sharing = Lamp.variant((current, message) => {
					if (message.by === 1) return { model: shared };
					Object.assign(current, { count: 5 });
					return { model: current };
				});
				const story = Story.make(
					'shares',
					sharing,
					lamp.given(Lamp.off),
					lamp.send(Lamp.switched(1)),
					lamp.send(Lamp.switched(2)),
					lamp.model(shared)
				);
				const before = Story.lines(story);
				expect(yield* failure(story)).toMatchObject({
					step: 3,
					problem: 'update changed its input'
				});
				expect(Story.lines(story)).toEqual(before);
				expect(shared).toEqual({ ...Lamp.off, on: true });
			})
		);

		it.effect('an update that gives another result for the same input', () =>
			Effect.gen(function* () {
				let calls = 0;
				const drifting = Lamp.variant((current) => {
					calls += 1;
					return { model: { ...current, count: calls } };
				});
				const story = Story.make(
					'drifts',
					drifting,
					lamp.given(Lamp.off),
					lamp.send(Lamp.switched())
				);
				expect(yield* failure(story)).toMatchObject({
					step: 2,
					problem: 'update gave two results for the same input'
				});
			})
		);

		it.effect('an update that returns an invalid model or command', () =>
			Effect.gen(function* () {
				const halves = Lamp.variant((current) => ({ model: { ...current, count: 0.5 } }));
				expect(
					yield* failure(
						Story.make('model', halves, lamp.given(Lamp.off), lamp.send(Lamp.switched()))
					)
				).toMatchObject({
					step: 2,
					problem: 'the model is invalid: Expected an integer\n  at ["count"]'
				});
				const blank = Lamp.variant((current) => ({
					model: current,
					commands: [Lamp.Log.make({ text: '' }, { disableChecks: true })]
				}));
				expect(
					yield* failure(
						Story.make('command', blank, lamp.given(Lamp.off), lamp.send(Lamp.switched()))
					)
				).toMatchObject({
					step: 2,
					problem:
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
				const { given: start, send: switches } = Story.of(opaque);
				expect(yield* failure(Story.make('json', opaque, start({ value: 1n })))).toMatchObject({
					step: 1,
					line: 'given (not JSON: Expected JSON value at ["value"])',
					problem: 'the model does not survive JSON: Expected JSON value\n  at ["value"]'
				});
				const producing = Program.make({ ...opaque, update: () => ({ model: { value: 1n } }) });
				const produced = yield* failure(
					Story.make('produced', producing, start({ value: 0 }), switches(Lamp.switched()))
				);
				expect(produced).toBeInstanceOf(Story.StoryFailure);
				expect(produced).toMatchObject({
					step: 2,
					problem: 'the model is not JSON: Expected JSON value\n  at ["value"]'
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
					problem: produced.problem,
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
				expect(
					yield* failure(Story.make('lossy', trimmed, Story.of(trimmed).given(' padded ')))
				).toMatchObject({
					step: 1,
					problem: 'the model changes through JSON',
					expected: '" padded "',
					actual: '"padded"'
				});
			})
		);

		it.effect('a broken invariant, before and after a step', () =>
			Effect.gen(function* () {
				const big = { ...Lamp.off, count: 10 };
				expect(yield* failure(Story.make('given', Lamp.lamp, lamp.given(big)))).toMatchObject({
					step: 1,
					problem: 'invariant countIsSmall does not hold',
					actual: '{"at":"2026-11-03T00:00:00.000Z","count":10,"on":0}'
				});
				expect(
					yield* failure(
						Story.make('sent', Lamp.lamp, lamp.given(Lamp.off), lamp.send(Lamp.switched(10)))
					)
				).toMatchObject({ step: 2, problem: 'invariant countIsSmall does not hold' });
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
				expect(yield* failure(Story.make('throws', explosive, lamp.given(Lamp.off)))).toMatchObject(
					{
						step: 1,
						problem: 'invariant explodes threw: Error: boom'
					}
				);
			})
		);

		it.effect('an invariant or satisfies that changes the model the story keeps', () =>
			Effect.gen(function* () {
				const tampering = Program.make({
					...Lamp.lamp,
					invariants: { counted: (current) => Boolean(Object.assign(current, { count: 9 })) }
				});
				expect(yield* failure(Story.make('invariant', tampering, lamp.given(Lamp.off)))).toEqual(
					expect.objectContaining({
						step: 1,
						problem: 'invariant counted changed its input',
						expected: '{"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}',
						actual: '{"at":"2026-11-03T00:00:00.000Z","count":9,"on":0}'
					})
				);
				const invalidating = Program.make({
					...Lamp.lamp,
					invariants: { dated: (current) => current.at.setTime(Number.NaN) !== 0 }
				});
				expect(
					yield* failure(Story.make('unencodable', invalidating, lamp.given(Lamp.off)))
				).toMatchObject({
					step: 1,
					problem: 'invariant dated changed its input',
					actual: 'its input is not JSON: Expected a valid Date\n  at ["at"]'
				});
				// Without the check, the reset would make the story's model pass.
				expect(
					yield* failure(
						Story.make(
							'satisfies',
							Lamp.lamp,
							lamp.given(Lamp.off),
							lamp.satisfies('reset', (current) => Boolean(Object.assign(current, { count: 5 }))),
							lamp.model({ ...Lamp.off, count: 5 })
						)
					)
				).toMatchObject({ step: 2, line: 'satisfies reset', problem: 'reset changed its input' });
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
					lamp.given(Lamp.off),
					lamp.send(Lamp.switched()),
					lamp.send(Lamp.switched()),
					lamp.commands(by, logged),
					lamp.resolve(logged),
					lamp.commands(by)
				);
				yield* Story.run(story);
			})
		);

		it.effect('may cancel one that is not pending', () =>
			Effect.gen(function* () {
				const cancelling = Lamp.variant((current) => ({ model: current, cancels: [logged] }));
				yield* Story.run(
					Story.make('cancels', cancelling, lamp.given(Lamp.off), lamp.send(Lamp.switched()))
				);
			})
		);
	});

	it.effect('starts from a given inside a leading group', () =>
		Effect.gen(function* () {
			const story = Story.make('grouped', chat, steps(given(ready(1)), model(ready(1))));
			expect((yield* Story.run(story)).finals[0].model).toEqual(ready(1));
		})
	);

	it.effect('accepts a codec model given and checked by its typed values', () =>
		Effect.gen(function* () {
			const story = Story.make(
				'switches',
				Lamp.lamp,
				lamp.given(Lamp.off),
				lamp.send(Lamp.switched()),
				lamp.model({ on: true, at: new Date('2026-11-04T00:00:00.000Z'), count: 1 })
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
					yield* failure(Story.make('throws', throwing, lamp.given(Lamp.off), lamp.restart()))
				).toMatchObject({
					step: 2,
					line: 'restart',
					problem: 'resume threw: Error: no disk'
				});
				const mutating = resuming((current) => {
					current.at.setUTCDate(current.at.getUTCDate() + 1);
					return { model: current };
				});
				expect(
					yield* failure(Story.make('mutates', mutating, lamp.given(Lamp.off), lamp.restart()))
				).toMatchObject({
					step: 2,
					problem: 'resume changed its input'
				});
			})
		);

		const { Started, StepDone } = Conversation.Message.cases;

		it.effect('round-trips the model, drops pending commands and resumes', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a restart redoes the running step',
					Conversation.conversation,
					conversation.given(Conversation.idle),
					conversation.send(Started.make({ turn: 't1' })),
					conversation.commands(step(0)),
					conversation.resolve(
						step(0),
						StepDone.make({ turn: 't1', step: 0, output: 'a', last: false })
					),
					conversation.commands(step(1)),
					conversation.restart(),
					conversation.commands(step(1)),
					conversation.resolve(
						step(1),
						StepDone.make({ turn: 't1', step: 1, output: 'b', last: true })
					),
					conversation.model(Conversation.Phase.cases.Done.make({ turn: 't1', output: 'ab' }))
				);
				expect((yield* Story.run(story)).finals[0].model).toEqual(
					Conversation.Phase.cases.Done.make({ turn: 't1', output: 'ab' })
				);
			})
		);

		it.effect('replaces the dropped commands with those resume asks for', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'dropped',
					Conversation.conversation,
					conversation.given(Conversation.idle),
					conversation.send(Started.make({ turn: 't1' })),
					conversation.commands(step(0)),
					conversation.restart(),
					conversation.resolve(step(0)),
					conversation.resolve(step(0))
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					problem: 'RunStep {"step":0,"turn":"t1"} is not pending'
				});
			})
		);

		it.effect('uses the default resume, which keeps the model and starts nothing', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'lamp',
					Lamp.lamp,
					lamp.given(Lamp.off),
					lamp.restart(),
					lamp.model(Lamp.off)
				);
				expect((yield* Story.run(story)).finals[0].model).toEqual(Lamp.off);
			})
		);
	});

	describe('anyOrder', () => {
		const { Started, StepDone, Recall } = Conversation.Message.cases;
		const started = conversation.steps(
			conversation.send(Started.make({ turn: 't1' })),
			conversation.commands(step(0))
		);

		it.effect('permutes a group as one unit and names the order that failed', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a recall before the start does not stop it',
					Conversation.conversation,
					conversation.given(Conversation.idle),
					conversation.anyOrder(started, conversation.send(Recall.make({ turn: 't1' }))),
					conversation.model(Conversation.Phase.cases.Recalled.make({ turn: 't1' }))
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
					problem: 'in order 5, 3, 4: the model differs',
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
					conversation.given(Conversation.idle),
					started,
					conversation.anyOrder(
						conversation.send(Recall.make({ turn: 't1' })),
						conversation.resolve(
							step(0),
							StepDone.make({ turn: 't1', step: 0, output: 'a', last: true })
						)
					),
					conversation.model(Conversation.Phase.cases.Recalled.make({ turn: 't1' })),
					conversation.commands()
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
					conversation.given(Conversation.idle),
					started,
					conversation.anyOrder(
						conversation.resolve(
							step(0),
							StepDone.make({ turn: 't1', step: 0, output: 'a', last: false })
						),
						conversation.send(Recall.make({ turn: 't1' }))
					),
					conversation.commands()
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					problem:
						'in order 5, 6: RunStep {"step":1,"turn":"t1"} was cancelled before any step asserted it'
				});
			})
		);

		it.effect('owes the steps after a group the commands produced before it', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a recall after the group stops an unasserted step',
					Conversation.conversation,
					conversation.given(Conversation.idle),
					conversation.send(Started.make({ turn: 't1' })),
					conversation.anyOrder(
						conversation.satisfies('working', Conversation.Phase.guards.Working),
						conversation.model(
							Conversation.Phase.cases.Working.make({ turn: 't1', step: 0, output: '' })
						)
					),
					conversation.send(Recall.make({ turn: 't1' }))
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					problem:
						'in order 4, 5: RunStep {"step":0,"turn":"t1"} was cancelled before any step asserted it'
				});
			})
		);

		it.effect('fails a reply to a command that completed, not cancelled, earlier', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'answered twice',
					Conversation.conversation,
					conversation.given(Conversation.idle),
					started,
					conversation.anyOrder(
						conversation.resolve(
							step(0),
							StepDone.make({ turn: 't1', step: 0, output: 'a', last: true })
						),
						conversation.resolve(
							step(0),
							StepDone.make({ turn: 't1', step: 0, output: 'b', last: true })
						)
					)
				);
				expect(yield* failure(story)).toMatchObject({
					step: 6,
					problem: 'in order 5, 6: RunStep {"step":0,"turn":"t1"} is not pending'
				});
			})
		);

		// A switch by 0 resets the count, so the order decides where a story ends.
		const resetter = Lamp.variant((current, { at, by }) => ({
			model: { on: current.on, at, count: by === 0 ? 0 : current.count + by }
		}));
		const resetting = Story.of(resetter);
		const at = new Date('2026-11-04T00:00:00.000Z');

		it.effect('gives the final model of every order, also when orders end apart', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a reset and a switch',
					resetter,
					resetting.given(Lamp.off),
					resetting.anyOrder(resetting.send(Lamp.switched(1)), resetting.send(Lamp.switched(0)))
				);
				expect(yield* Story.run(story)).toEqual({
					finals: [
						{
							order: [3, 4],
							model: { on: false, at, count: 0 },
							final: '{"at":"2026-11-04T00:00:00.000Z","count":0,"on":0}'
						},
						{
							order: [4, 3],
							model: { on: false, at, count: 1 },
							final: '{"at":"2026-11-04T00:00:00.000Z","count":1,"on":0}'
						}
					],
					cases: ['Message.Switched']
				});
			})
		);

		it.effect('orders a nested anyOrder after the one around it', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'switches in any order',
					resetter,
					resetting.given(Lamp.off),
					resetting.anyOrder(
						resetting.send(Lamp.switched(1)),
						resetting.anyOrder(resetting.send(Lamp.switched(2)), resetting.send(Lamp.switched(3)))
					),
					resetting.satisfies('counted', (current) => current.count === 6)
				);
				const { finals } = yield* Story.run(story);
				expect(finals.map(({ order }) => order)).toEqual([
					[3, 4, 5, 6],
					[3, 4, 6, 5],
					[4, 3, 5, 6],
					[4, 3, 6, 5]
				]);
			})
		);

		it.effect('names a nested order after the one around it when it fails', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'a reset among switches',
					resetter,
					resetting.given(Lamp.off),
					resetting.anyOrder(
						resetting.send(Lamp.switched(1)),
						resetting.anyOrder(resetting.send(Lamp.switched(0)), resetting.send(Lamp.switched(3)))
					),
					resetting.satisfies('counted', (current) => current.count > 0)
				);
				expect(yield* failure(story)).toMatchObject({
					step: 7,
					problem: 'in order 3, 4, 6, 5: the model does not satisfy counted'
				});
			})
		);

		it.effect('names the order that failed', () =>
			Effect.gen(function* () {
				const story = Story.make(
					'order matters',
					Conversation.conversation,
					conversation.given(Conversation.idle),
					started,
					conversation.anyOrder(
						conversation.send(Recall.make({ turn: 't1' })),
						conversation.resolve(
							step(0),
							StepDone.make({ turn: 't1', step: 0, output: 'a', last: true })
						)
					),
					conversation.satisfies('done', Conversation.Phase.guards.Done)
				);
				expect(yield* failure(story)).toMatchObject({
					step: 7,
					problem: 'in order 5, 6: the model does not satisfy done'
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
