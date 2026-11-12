// The chat's tales as docs/stories.md, docs/explorations.md and docs/vitest.md show them.
import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Schema } from 'effect';
import { Exploration, Story, Tale, Vitest } from 'effect-storytime/testing';
import { Chat, chat, Command, Message, ready } from '../examples/chat.ts';

const { Asked, Delta, Answered, Refused, Stopped } = Message.cases;
const { Ask, SaveTurn } = Command.cases;
const { Ready, Asking, Limited, SignedOut } = Chat.cases;

// #region answers
const ask = Ask.make({ turn: 't1', text: 'Why Effect?' });
const turn = { id: 't1', question: 'Why Effect?', answer: 'Typed errors.' };

const answers = Story.make(
	'a question is answered while it streams',
	chat,
	Story.given(ready(2)),
	Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	Story.commands(ask),
	Story.emit(ask, Delta.make({ turn: 't1', text: 'Typed errors.' })),
	Story.resolve(ask, Answered.make({ turn: 't1', left: 1 })),
	Story.commands(SaveTurn.make(turn)),
	// A command that answers with no message resolves without a reply.
	Story.resolve(SaveTurn.make(turn)),
	Story.model(Ready.make({ turns: [turn], left: 1 }))
);
// #endregion answers

// #region stops
const stops = Story.make(
	'a stop and a late delta land in either order',
	chat,
	Story.given(ready(2)),
	Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	Story.commands(ask),
	Story.anyOrder(
		Story.send(Stopped.make({})),
		// Skipped in the order where the stop cancelled `ask` first.
		Story.emit(ask, Delta.make({ turn: 't1', text: 'Typed' }))
	),
	Story.model(ready(2)),
	Story.commands()
);
// #endregion stops

// #region resumes
const resumes = Story.make(
	'a restart asks again from the start',
	chat,
	Story.given(ready(2)),
	Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	Story.commands(ask),
	Story.emit(ask, Delta.make({ turn: 't1', text: 'Typed' })),
	// The model goes through JSON, `ask` is dropped and `resume` asks again with an empty answer.
	Story.restart(),
	Story.model(Asking.make({ turns: [], left: 2, turn: 't1', question: 'Why Effect?', answer: '' })),
	Story.commands(ask)
);
// #endregion resumes

// #region shared
// A part several stories share. Outside `Story.make` nothing infers its types, so it names them.
const asked = Story.steps<Chat, Message, Command>(
	Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	Story.commands(ask)
);

const limited = Story.make(
	'a refusal at the limit locks the chat',
	chat,
	Story.given(ready(2)),
	asked,
	Story.resolve(ask, Refused.make({ turn: 't1', reason: 'LimitReached' })),
	Story.satisfies('limited', Chat.guards.Limited)
);

const signedOut = Story.make(
	'a refusal for a signed-out user signs the chat out',
	chat,
	Story.given(ready(2)),
	asked,
	Story.resolve(ask, Refused.make({ turn: 't1', reason: 'SignedOut' })),
	Story.model(SignedOut.make({}))
);
// #endregion shared

// #region explore
const talks = Exploration.make('any conversation keeps the chat valid', chat, {
	given: Arbitrary.map(Arbitrary.schema(Schema.Literals([0, 1, 2])), ready),
	// By default any message the Message Schema allows; this one asks about two turns and stops.
	send: Arbitrary.map(Arbitrary.schema(Schema.Literals(['t1', 't2', 'stop'])), (pick) =>
		pick === 'stop' ? Stopped.make({}) : Asked.make({ turn: pick, text: `question ${pick}` })
	),
	// The messages that complete a pending command; SaveTurn has none, so it stays pending.
	replies: Command.match({
		Ask: ({ turn: asking }) => [
			Answered.make({ turn: asking, left: 1 }),
			Refused.make({ turn: asking, reason: 'Busy' }),
			Refused.make({ turn: asking, reason: 'SignedOut' })
		],
		SaveTurn: () => []
	}),
	// The messages a pending command streams while it stays pending.
	emits: Command.match({
		Ask: ({ turn: asking }) => [Delta.make({ turn: asking, text: 'more' })],
		SaveTurn: () => []
	})
});
// #endregion explore

// #region vitest
describe('chat', () => {
	// One test per tale, named by its title.
	Vitest.stories(answers, stops, resumes, limited, signedOut, talks);
	// One test, 'its tales touch every case': together they reach every Model, Message and Command case.
	Vitest.covers(chat, [answers, stops, resumes, limited, signedOut, talks]);
});
// #endregion vitest

describe('chat tales', () => {
	it('render as lines', () => {
		// #region lines
		expect(Story.lines(answers)).toEqual([
			'given Ready {"left":2,"turns":[]}',
			'send Asked {"text":"Why Effect?","turn":"t1"}',
			'commands Ask {"text":"Why Effect?","turn":"t1"}',
			'emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"Typed errors.","turn":"t1"}',
			'resolve Ask {"text":"Why Effect?","turn":"t1"} → Answered {"left":1,"turn":"t1"}',
			'commands SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
			'resolve SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
			'model Ready {"left":1,"turns":[{"answer":"Typed errors.","id":"t1","question":"Why Effect?"}]}'
		]);
		expect(Story.lines(stops)).toEqual([
			'given Ready {"left":2,"turns":[]}',
			'send Asked {"text":"Why Effect?","turn":"t1"}',
			'commands Ask {"text":"Why Effect?","turn":"t1"}',
			'any order',
			'  send Stopped',
			'  emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"Typed","turn":"t1"}',
			'model Ready {"left":2,"turns":[]}',
			'commands none'
		]);
		expect(Tale.lines(talks)).toEqual([
			'explore 100 runs of up to 30 steps, seed "any conversation keeps the chat valid", with restarts'
		]);
		// #endregion lines
	});

	it.effect('give their outcome', () =>
		Effect.gen(function* () {
			// #region outcome
			const { model, final, cases } = yield* Story.run(limited);
			expect(model).toEqual(Limited.make({ turns: [] }));
			expect(final).toBe('Limited {"turns":[]}');
			expect(cases).toEqual([
				'Command.Ask',
				'Message.Asked',
				'Message.Refused',
				'Model.Asking',
				'Model.Limited',
				'Model.Ready'
			]);
			// #endregion outcome
		})
	);

	it.effect('fail at the step that broke a rule', () =>
		Effect.gen(function* () {
			// #region failure
			const forgets = Story.make(
				'an answer is forgotten',
				chat,
				Story.given(ready(2)),
				Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
				Story.commands(ask),
				Story.resolve(ask, Answered.make({ turn: 't1', left: 1 }))
				// SaveTurn is never asserted.
			);
			const failure = yield* Effect.flip(Story.run(forgets));
			expect(failure).toBeInstanceOf(Story.StoryFailure);
			expect(failure).toMatchObject({
				title: 'an answer is forgotten',
				step: 5,
				line: 'end',
				message: 'the story ended with 1 unasserted command(s)',
				actual: 'SaveTurn {"answer":"","id":"t1","question":"Why Effect?"}'
			});
			// #endregion failure
		})
	);
});
