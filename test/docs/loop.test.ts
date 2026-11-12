// The Loop as docs/loop.md shows it, running the chat example.
import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref, Stream } from 'effect';
import { Loop } from 'effect-storytime';
import { Chat, chat, Command, Message, ready } from '../examples/chat.ts';

const { Asked, Delta, Answered } = Message.cases;

describe('a Loop', () => {
	it.effect('answers a question with a streaming command', () =>
		Effect.gen(function* () {
			// #region run
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				// The Command union's exhaustive match: a new command without a handler does not compile.
				handler: Command.match({
					// A Stream handler answers with every message it emits.
					Ask: ({ turn }) =>
						Stream.make(
							Delta.make({ turn, text: 'Typed errors.' }),
							Answered.make({ turn, left: 1 })
						),
					// An Effect handler answers with one message, or none.
					SaveTurn: () => Effect.void
				})
			});
			// Returns once `update` ran and the commands started, not when they finish.
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			const answered = yield* loop.changes.pipe(Stream.filter(Chat.guards.Ready), Stream.runHead);
			// #endregion run
			expect(answered).toEqual(
				Option.some(
					Chat.cases.Ready.make({
						turns: [{ id: 't1', question: 'Why Effect?', answer: 'Typed errors.' }],
						left: 1
					})
				)
			);
		})
	);

	it.effect('resumes a stored model after a restart', () =>
		Effect.gen(function* () {
			// #region persist
			const stored = yield* Ref.make(Option.none<Chat>());
			const persist = {
				load: Ref.get(stored),
				save: (model: Chat) => Ref.set(stored, Option.some(model))
			};

			// The first process asks, then stops before the answer arrives: closing its scope
			// interrupts the running Ask.
			yield* Effect.scoped(
				Effect.gen(function* () {
					const first = yield* Loop.make(chat, {
						init: { model: ready(2) },
						handler: Command.match({ Ask: () => Effect.never, SaveTurn: () => Effect.void }),
						persist
					});
					yield* first.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
				})
			);

			// The next one loads the stored Asking model, and `resume` asks again.
			const second = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({
					Ask: ({ turn }) => Effect.succeed(Answered.make({ turn, left: 1 })),
					SaveTurn: () => Effect.void
				}),
				persist
			});
			const answered = yield* second.changes.pipe(Stream.filter(Chat.guards.Ready), Stream.runHead);
			// #endregion persist
			expect(answered).toEqual(
				Option.some(
					Chat.cases.Ready.make({
						turns: [{ id: 't1', question: 'Why Effect?', answer: '' }],
						left: 1
					})
				)
			);
		})
	);
});
