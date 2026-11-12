// The Loop as docs/loop.md shows it, running the chat example.
import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref, Stream } from 'effect';
import { Loop } from 'effect-storytime';
import { Chat, chat, Command, Message, ready } from '../examples/chat.ts';

const { Asked, Delta, Answered } = Message.cases;
const { Ready } = Chat.cases;

describe('a Loop', () => {
	it.effect('answers a question with a streaming command', () =>
		Effect.gen(function* () {
			// #region make
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
			// Waits until no command runs: Ask, then the SaveTurn its answer led to.
			const answered = yield* loop.settled;
			// #endregion make
			expect(answered).toEqual(
				Ready.make({
					turns: [{ id: 't1', question: 'Why Effect?', answer: 'Typed errors.' }],
					left: 1
				})
			);
		})
	);

	it.effect('resumes a stored model and writes each turn with it', () =>
		Effect.gen(function* () {
			// #region store
			// The stored model and the transcript, as a database would hold them.
			const stored = yield* Ref.make(Option.none<Chat>());
			const transcript = yield* Ref.make<ReadonlyArray<string>>([]);
			const store: Loop.Store<Chat, never, never> = {
				load: Ref.get(stored),
				save: (model) => Ref.set(stored, Option.some(model)),
				// A database runs the effect in its transaction, `sql.withTransaction`; memory has
				// nothing to roll back.
				transaction: (effect) => effect
			};
			const handler = (ask: Loop.Work<Message, never, never>) =>
				Command.match({
					Ask: () => ask,
					// A write runs in its transition's transaction, so the turn commits with the model.
					SaveTurn: ({ question, answer }) =>
						Loop.write(Ref.update(transcript, (lines) => [...lines, `${question} ${answer}`]))
				});

			// The first process asks, then stops before the answer arrives: closing its scope
			// interrupts the running Ask.
			yield* Effect.scoped(
				Effect.gen(function* () {
					const first = yield* Loop.make(chat, {
						init: { model: ready(2) },
						handler: handler(Effect.never),
						store
					});
					yield* first.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
				})
			);

			// The next one loads the stored Asking model, and `resume` asks again.
			const second = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: handler(Effect.succeed(Answered.make({ turn: 't1', left: 1 }))),
				store
			});
			const answered = yield* second.settled;
			// #endregion store
			expect(answered).toEqual(
				Ready.make({ turns: [{ id: 't1', question: 'Why Effect?', answer: '' }], left: 1 })
			);
			expect(yield* Ref.get(stored)).toEqual(Option.some(answered));
			expect(yield* Ref.get(transcript)).toEqual(['Why Effect? ']);
		})
	);
});
