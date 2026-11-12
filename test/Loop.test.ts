import { describe, expect, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Option, Queue, Ref, Stream } from 'effect';
import { Loop } from 'effect-storytime';
import { Chat, chat, Command, Message, ready } from './examples/chat.ts';
import * as Fetch from './examples/fetch.ts';

const { Asked, Delta, Answered, Refused, Stopped } = Message.cases;
const { Ask } = Command.cases;
const asking = Chat.cases.Asking.make({
	turns: [],
	left: 2,
	turn: 't1',
	question: 'Why Effect?',
	answer: ''
});
const answered = (left: number) =>
	Chat.cases.Ready.make({
		turns: [{ id: 't1', question: 'Why Effect?', answer: 'Typed errors.' }],
		left
	});

const settled = (loop: Loop.Loop<Chat, Message>, done: (model: Chat) => boolean) =>
	loop.changes.pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow));

const noSave = () => Effect.void;

const hang = (started: Deferred.Deferred<void>, interrupted: Deferred.Deferred<void>) =>
	Deferred.succeed(started, undefined).pipe(
		Effect.andThen(Effect.never),
		Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
	);

const { Failed, Fetched, Dropped } = Fetch.Message.cases;
const page = { page: '1' };

/**
 * A fetch Loop whose fetch answers at once, the first with `Fetched`, later ones with `Dropped`,
 * recording the messages it applies. Its first retry holds the loop in its save until `racer`
 * is enqueued behind it.
 */
const racing = (racer: Fetch.Message) =>
	Effect.gen(function* () {
		const applied: Array<Fetch.Message['_tag']> = [];
		const holding = yield* Deferred.make<void>();
		const unblock = yield* Deferred.make<void>();
		const fetches = yield* Ref.make(0);
		const loop = yield* Loop.make(
			{
				...Fetch.fetch,
				update: (model: Fetch.Model, message: Fetch.Message) => {
					applied.push(message._tag);
					return Fetch.fetch.update(model, message);
				}
			},
			{
				init: { model: Fetch.start },
				handler: Fetch.Command.match({
					Fetch: ({ params }) =>
						Effect.map(
							Ref.getAndUpdate(fetches, (n) => n + 1),
							(n) => (n === 0 ? Fetched.make({ params }) : Dropped.make({ params }))
						),
					Note: () => Effect.void
				}),
				persist: {
					load: Effect.succeedNone,
					save: (model) =>
						model.attempts === 1
							? Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(unblock))
							: Effect.void
				}
			}
		);
		yield* Effect.forkChild(loop.dispatch(Failed.make({ params: page })));
		yield* Deferred.await(holding);
		const raced = yield* Effect.forkChild(loop.dispatch(racer), { startImmediately: true });
		yield* Deferred.succeed(unblock, undefined);
		// The replies are enqueued once the racer applied; this lands behind them.
		yield* Fiber.join(raced);
		yield* loop.dispatch(Dropped.make({ params: { page: 'other' } }));
		return { applied, model: yield* loop.model };
	});

describe('Loop', () => {
	it.effect('streams an answer into the model and runs the command it leads to', () =>
		Effect.gen(function* () {
			const saved = yield* Deferred.make<Command>();
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({
					Ask: ({ turn }) =>
						Stream.make(
							Delta.make({ turn, text: 'Typed ' }),
							Delta.make({ turn, text: 'errors.' }),
							Answered.make({ turn, left: 1 })
						),
					SaveTurn: (command) => Effect.asVoid(Deferred.succeed(saved, command))
				})
			});
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			expect(yield* settled(loop, Chat.guards.Ready)).toEqual(answered(1));
			expect(yield* Deferred.await(saved)).toEqual(
				Command.cases.SaveTurn.make({ id: 't1', question: 'Why Effect?', answer: 'Typed errors.' })
			);
		})
	);

	it.effect('feeds back the message an effect handler answers with', () =>
		Effect.gen(function* () {
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({
					Ask: ({ turn }) => Effect.succeed(Refused.make({ turn, reason: 'LimitReached' })),
					SaveTurn: noSave
				})
			});
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			expect(yield* settled(loop, Chat.guards.Limited)).toEqual(
				Chat.cases.Limited.make({ turns: [] })
			);
		})
	);

	it.effect('feeds nothing back when an effect handler answers with nothing', () =>
		Effect.gen(function* () {
			const updates: Array<Fetch.Message> = [];
			const noted = yield* Deferred.make<void>();
			const program = {
				...Fetch.fetch,
				update: (model: Fetch.Model, message: Fetch.Message) => {
					updates.push(message);
					return Fetch.fetch.update(model, message);
				}
			};
			const loop = yield* Loop.make(program, {
				init: { model: Fetch.start, commands: [Fetch.Command.cases.Note.make({ text: 'hi' })] },
				handler: Fetch.Command.match({
					Fetch: () => Effect.never,
					Note: () => Effect.asVoid(Deferred.succeed(noted, undefined))
				})
			});
			yield* Deferred.await(noted);
			const request = Fetch.Message.cases.Requested.make({ params: {} });
			yield* loop.dispatch(request);
			expect(updates).toEqual([request]);
		})
	);

	it.effect('interrupts a cancelled command', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			const loop = yield* Loop.make(chat, {
				init: { model: asking, commands: [Ask.make({ turn: 't1', text: 'Why Effect?' })] },
				handler: Command.match({ Ask: () => hang(started, interrupted), SaveTurn: noSave })
			});
			yield* Deferred.await(started);
			yield* loop.dispatch(Stopped.make({}));
			yield* Deferred.await(interrupted);
			expect(yield* loop.model).toEqual(Chat.cases.Ready.make({ turns: [], left: 2 }));
		})
	);

	it.effect('replaces a running command with an identical new one', () =>
		Effect.gen(function* () {
			const starts = yield* Queue.unbounded<void>();
			const interrupted = yield* Deferred.make<void>();
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({
					Ask: ({ turn }) =>
						Stream.concat(
							Stream.make(Refused.make({ turn, reason: 'Busy' })),
							Stream.fromEffect(
								Queue.offer(starts, undefined).pipe(
									Effect.andThen(Effect.never),
									Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
								)
							)
						),
					SaveTurn: noSave
				})
			});
			const question = Asked.make({ turn: 't1', text: 'Why Effect?' });
			yield* loop.dispatch(question);
			yield* Queue.take(starts);
			yield* loop.dispatch(question);
			yield* Deferred.await(interrupted);
			yield* Queue.take(starts);
		})
	);

	it.effect('saves each model before its commands start', () =>
		Effect.gen(function* () {
			const log = yield* Ref.make<ReadonlyArray<string>>([]);
			const note = (entry: string) => Ref.update(log, (all) => [...all, entry]);
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({
					Ask: () => Effect.as(note('ask'), Answered.make({ turn: 't1', left: 1 })),
					SaveTurn: () => note('save turn')
				}),
				persist: { load: Effect.succeedNone, save: (model) => note(`store ${model._tag}`) }
			});
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			yield* settled(loop, Chat.guards.Ready).pipe(
				Effect.andThen(settled(loop, (model) => Chat.guards.Ready(model) && model.left === 1))
			);
			yield* Effect.yieldNow;
			expect(yield* Ref.get(log)).toEqual([
				'store Ready',
				'store Asking',
				'ask',
				'store Ready',
				'save turn'
			]);
		})
	);

	it.effect('resumes a stored model instead of starting from init', () =>
		Effect.gen(function* () {
			const asked = yield* Deferred.make<Command>();
			const loop = yield* Loop.make(chat, {
				init: { model: ready(5) },
				handler: Command.match({
					Ask: (command) => Effect.asVoid(Deferred.succeed(asked, command)),
					SaveTurn: noSave
				}),
				persist: { load: Effect.succeedSome(asking), save: noSave }
			});
			expect(yield* Deferred.await(asked)).toEqual(
				Command.cases.Ask.make({ turn: 't1', text: 'Why Effect?' })
			);
			expect(yield* loop.model).toEqual(asking);
		})
	);

	it.effect('interrupts running commands when its scope closes', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			yield* Effect.scoped(
				Effect.andThen(
					Loop.make(chat, {
						init: { model: asking, commands: [Ask.make({ turn: 't1', text: 'Why Effect?' })] },
						handler: Command.match({ Ask: () => hang(started, interrupted), SaveTurn: noSave })
					}),
					Deferred.await(started)
				)
			);
			expect(yield* Deferred.isDone(interrupted)).toBe(true);
		})
	);

	it.effect('fails the dispatch whose update throws and keeps running', () =>
		Effect.gen(function* () {
			const broken = {
				...chat,
				update: (model: Chat, message: Message) =>
					Message.guards.Stopped(message)
						? chat.update(model, message)
						: Option.getOrThrow(Option.none())
			};
			const loop = yield* Loop.make(broken, {
				init: { model: asking },
				handler: Command.match({ Ask: () => Effect.never, SaveTurn: noSave })
			});
			const exit = yield* Effect.exit(loop.dispatch(Asked.make({ turn: 't2', text: 'Again?' })));
			expect(exit._tag).toBe('Failure');
			yield* loop.dispatch(Stopped.make({}));
			expect(yield* loop.model).toEqual(Chat.cases.Ready.make({ turns: [], left: 2 }));
		})
	);
	it.effect('starts the next command when a final stream message cancels its own command', () =>
		Effect.gen(function* () {
			const noted = yield* Deferred.make<string>();
			const params = { page: '1' };
			const loop = yield* Loop.make(Fetch.fetch, {
				init: { model: Fetch.start },
				handler: Fetch.Command.match({
					Fetch: () =>
						Stream.concat(Stream.make(Fetch.Message.cases.Fetched.make({ params })), Stream.never),
					Note: ({ text }) => Effect.asVoid(Deferred.succeed(noted, text))
				})
			});
			yield* loop.dispatch(Fetch.Message.cases.Requested.make({ params }));
			expect(yield* Deferred.await(noted)).toBe('fetched');
			expect(yield* loop.model).toEqual({ attempts: 0, fetched: true });
		})
	);

	it.effect('starts the next command when a retry reply replaces its own command', () =>
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0);
			const noted = yield* Deferred.make<string>();
			const params = { page: '1' };
			const loop = yield* Loop.make(Fetch.fetch, {
				init: { model: Fetch.start },
				handler: Fetch.Command.match({
					Fetch: () =>
						Effect.flatMap(
							Ref.getAndUpdate(attempts, (n) => n + 1),
							(n) =>
								n === 0 ? Effect.succeed(Fetch.Message.cases.Failed.make({ params })) : Effect.never
						),
					Note: ({ text }) => Effect.asVoid(Deferred.succeed(noted, text))
				})
			});
			yield* loop.dispatch(Fetch.Message.cases.Requested.make({ params }));
			expect(yield* Deferred.await(noted)).toBe('retrying');
			expect(yield* Ref.get(attempts)).toBe(2);
		})
	);

	it.effect('drops a reply a command enqueued before it was cancelled', () =>
		Effect.gen(function* () {
			const { applied, model } = yield* racing(Dropped.make({ params: page }));
			expect(applied).toEqual(['Failed', 'Dropped', 'Dropped']);
			expect(model).toEqual({ attempts: 1, fetched: false });
		})
	);

	it.effect('drops a reply a command enqueued before an identical one replaced it', () =>
		Effect.gen(function* () {
			const { applied, model } = yield* racing(Failed.make({ params: page }));
			expect(applied).toEqual(['Failed', 'Failed', 'Dropped', 'Dropped']);
			expect(model).toEqual({ attempts: 2, fetched: false });
		})
	);

	it.effect('cancels a command named with its record keys in another order', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			const loop = yield* Loop.make(Fetch.fetch, {
				init: { model: Fetch.start },
				handler: Fetch.Command.match({ Fetch: () => hang(started, interrupted), Note: noSave })
			});
			yield* loop.dispatch(
				Fetch.Message.cases.Requested.make({ params: { first: '1', second: '2' } })
			);
			yield* Deferred.await(started);
			yield* loop.dispatch(
				Fetch.Message.cases.Dropped.make({ params: { second: '2', first: '1' } })
			);
			yield* Deferred.await(interrupted);
		})
	);
});
