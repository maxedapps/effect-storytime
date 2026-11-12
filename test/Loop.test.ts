import { describe, expect, it } from '@effect/vitest';
import { Data, Deferred, Effect, Exit, Fiber, Option, Queue, Ref, Scope, Stream } from 'effect';
import { Loop, Program } from 'effect-storytime';
import { Chat, chat, Command, Message, ready } from './examples/chat.ts';
import * as Fetch from './examples/fetch.ts';
import * as Lamp from './examples/lamp.ts';

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

const settled = (loop: Loop.Loop<Chat, Message, unknown>, done: (model: Chat) => boolean) =>
	loop.changes.pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow));

const noSave = () => Effect.void;

/** A store whose transaction adds nothing, for tests that watch only its loads and saves. */
const stored = <Model>(
	load: Effect.Effect<Option.Option<Model>>,
	save: (model: Model) => Effect.Effect<void>
): Loop.Store<Model, never, never> => ({ load, save, transaction: (effect) => effect });

const hang = (started: Deferred.Deferred<void>, interrupted: Deferred.Deferred<void>) =>
	Deferred.succeed(started, undefined).pipe(
		Effect.andThen(Effect.never),
		Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
	);

const { Requested, Failed, Fetched, Dropped } = Fetch.Message.cases;
const { Note } = Fetch.Command.cases;
const page = { page: '1' };
const fetching = Fetch.Command.cases.Fetch.make({ params: page });

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
				store: stored<Fetch.Model>(Effect.succeedNone, (model) =>
					model.attempts === 1
						? Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(unblock))
						: Effect.void
				)
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
				store: stored<Chat>(Effect.succeedNone, (model) => note(`store ${model._tag}`))
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
				store: stored<Chat>(Effect.succeedSome(asking), noSave)
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

	// The caller's finalizer strategy must not let the commands stop before the drain ends.
	for (const strategy of ['sequential', 'parallel'] as const)
		it.effect(`applies the messages dispatched before its ${strategy} scope closes`, () =>
			Effect.gen(function* () {
				const holding = yield* Deferred.make<void>();
				const unblock = yield* Deferred.make<void>();
				const scope = yield* Scope.make(strategy);
				const loop = yield* Scope.provide(
					Loop.make(chat, {
						init: { model: ready(2) },
						handler: Command.match({ Ask: () => Effect.never, SaveTurn: noSave }),
						store: stored<Chat>(Effect.succeedNone, (model) =>
							Chat.guards.Asking(model)
								? Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(unblock))
								: Effect.void
						)
					}),
					scope
				);
				const asked = yield* Effect.forkChild(
					loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }))
				);
				yield* Deferred.await(holding);
				const stopped = yield* Effect.forkChild(loop.dispatch(Stopped.make({})), {
					startImmediately: true
				});
				const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void), {
					startImmediately: true
				});
				yield* Deferred.succeed(unblock, undefined);
				yield* Fiber.join(closing);
				// Its Ask started before the commands were interrupted, so the dispatch completed.
				yield* Fiber.join(asked);
				yield* Fiber.join(stopped);
				expect(yield* loop.model).toEqual(ready(2));
			})
		);

	it.effect('interrupts a dispatch made after its scope closed', () =>
		Effect.gen(function* () {
			const loop = yield* Effect.scoped(
				Loop.make(chat, {
					init: { model: ready(2) },
					handler: Command.match({ Ask: () => Effect.never, SaveTurn: noSave })
				})
			);
			const exit = yield* Effect.exit(loop.dispatch(Stopped.make({})));
			expect(Exit.hasInterrupts(exit)).toBe(true);
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

	/** Chat, but a stop sets `left` to -1 and asks again, which breaks `leftIsNeverNegative`. */
	const careless = {
		...chat,
		update: (model: Chat, message: Message) =>
			Message.guards.Stopped(message)
				? {
						model: Chat.cases.Ready.make({ turns: [], left: -1 }),
						commands: [Ask.make({ turn: 't2', text: 'Again?' })]
					}
				: chat.update(model, message)
	};
	const brokenLeft = new Program.InvariantBroken({
		invariant: 'leftIsNeverNegative',
		state: 'Ready {"left":-1,"turns":[]}'
	});

	it.effect('dies on a message that breaks an invariant and keeps, saves and starts nothing', () =>
		Effect.gen(function* () {
			const log: Array<string> = [];
			const loop = yield* Loop.make(careless, {
				init: { model: asking },
				handler: Command.match({
					Ask: ({ turn }) => Effect.sync(() => void log.push(`ask ${turn}`)),
					SaveTurn: noSave
				}),
				store: stored<Chat>(Effect.succeedNone, (model) =>
					Effect.sync(() => void log.push(`store ${model._tag}`))
				)
			});
			const defect = yield* loop
				.dispatch(Stopped.make({}))
				.pipe(Effect.catchDefect(Effect.succeed));
			expect(defect).toEqual(brokenLeft);
			expect(yield* loop.model).toEqual(asking);
			yield* loop.dispatch(Answered.make({ turn: 't1', left: 1 }));
			expect(yield* loop.model).toEqual(
				Chat.cases.Ready.make({
					turns: [{ id: 't1', question: 'Why Effect?', answer: '' }],
					left: 1
				})
			);
			expect(log).toEqual(['store Asking', 'store Ready']);
		})
	);

	it.effect('dies on an invariant that changes the model and keeps, saves and starts nothing', () =>
		Effect.gen(function* () {
			const log: Array<string> = [];
			const tampering = Program.make({
				...chat,
				invariants: {
					stays: (model) => !Chat.guards.Ready(model) || Boolean(Object.assign(model, { left: 0 }))
				}
			});
			const loop = yield* Loop.make(tampering, {
				init: { model: asking },
				handler: Command.match({
					Ask: () => Effect.never,
					SaveTurn: noSave
				}),
				store: stored<Chat>(Effect.succeedNone, (model) =>
					Effect.sync(() => void log.push(`store ${model._tag}`))
				)
			});
			const defect = yield* loop
				.dispatch(Answered.make({ turn: 't1', left: 1 }))
				.pipe(Effect.catchDefect(Effect.succeed));
			expect(defect).toEqual(
				new Program.InvariantChanged({
					invariant: 'stays',
					before:
						'{"_tag":"Ready","left":1,"turns":[{"answer":"","id":"t1","question":"Why Effect?"}]}',
					after:
						'{"_tag":"Ready","left":0,"turns":[{"answer":"","id":"t1","question":"Why Effect?"}]}'
				})
			);
			expect(yield* loop.model).toEqual(asking);
			expect(log).toEqual(['store Asking']);
		})
	);

	it.effect('dies on an invariant that leaves the model unencodable', () =>
		Effect.gen(function* () {
			const defect = yield* Loop.make(
				Program.make({
					...Lamp.lamp,
					invariants: { dated: (current) => current.at.setTime(Number.NaN) !== 0 }
				}),
				{ init: { model: Lamp.off }, handler: () => Effect.void }
			).pipe(Effect.catchDefect(Effect.succeed));
			expect(defect).toEqual(
				new Program.InvariantChanged({
					invariant: 'dated',
					before: '{"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}',
					after: '(not JSON: Expected a valid Date at ["at"])'
				})
			);
		})
	);

	it.effect('runs identical commands of one transition once, as a story shows them', () =>
		Effect.gen(function* () {
			const written: Array<string> = [];
			let fetches = 0;
			yield* Loop.run(Fetch.fetch, {
				init: {
					model: Fetch.start,
					commands: [
						Note.make({ text: 'a' }),
						fetching,
						Note.make({ text: 'b' }),
						Note.make({ text: 'a' }),
						fetching
					]
				},
				handler: Fetch.Command.match({
					Fetch: ({ params }) =>
						Effect.sync(() => {
							fetches += 1;
							return Fetched.make({ params });
						}),
					Note: ({ text }) => Loop.write(Effect.sync(() => void written.push(text)))
				})
			});
			expect(written).toEqual(['a', 'b', 'fetched']);
			expect(fetches).toBe(1);
		})
	);

	it.effect('dies when its start breaks an invariant', () =>
		Effect.gen(function* () {
			const defect = yield* Loop.make(chat, {
				init: { model: Chat.cases.Ready.make({ turns: [], left: -1 }) },
				handler: Command.match({ Ask: () => Effect.never, SaveTurn: noSave })
			}).pipe(Effect.catchDefect(Effect.succeed));
			expect(defect).toEqual(brokenLeft);
		})
	);

	it.effect('joins a command that dies while its dispatch succeeds', () =>
		Effect.gen(function* () {
			const crash = new Error('the model provider is down');
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({ Ask: () => Effect.die(crash), SaveTurn: noSave })
			});
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			expect(yield* loop.join.pipe(Effect.catchDefect(Effect.succeed))).toBe(crash);
		})
	);

	it.effect('joins a command whose message breaks an invariant', () =>
		Effect.gen(function* () {
			const loop = yield* Loop.make(careless, {
				init: { model: ready(2) },
				handler: Command.match({ Ask: () => Effect.succeed(Stopped.make({})), SaveTurn: noSave })
			});
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			expect(yield* loop.join.pipe(Effect.catchDefect(Effect.succeed))).toEqual(brokenLeft);
			expect(yield* loop.model).toEqual(asking);
		})
	);

	it.effect('joins until its scope closes', () =>
		Effect.gen(function* () {
			const scope = yield* Scope.make();
			const loop = yield* Scope.provide(
				Loop.make(chat, {
					init: { model: asking, commands: [Ask.make({ turn: 't1', text: 'Why Effect?' })] },
					handler: Command.match({ Ask: () => Effect.never, SaveTurn: noSave })
				}),
				scope
			);
			const joined = yield* Effect.forkChild(loop.join);
			yield* Effect.yieldNow;
			expect(joined.pollUnsafe()).toBeUndefined();
			yield* Scope.close(scope, Exit.void);
			expect(yield* Fiber.await(joined)).toEqual(Exit.void);
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

	it.effect('restarts a command that a transition both cancels and starts', () =>
		Effect.gen(function* () {
			const fetches = yield* Ref.make(0);
			const loop = yield* Loop.make(
				{
					...Fetch.fetch,
					// Requested restarts the fetch: it cancels the running one and starts it again.
					update: (model: Fetch.Model, message: Fetch.Message) =>
						Fetch.Message.guards.Requested(message)
							? { model, cancels: [fetching], commands: [fetching] }
							: Fetch.fetch.update(model, message)
				},
				{
					init: { model: Fetch.start, commands: [fetching] },
					handler: Fetch.Command.match({
						// The first fetch hangs; the restarted one answers.
						Fetch: ({ params }) =>
							Effect.flatMap(
								Ref.getAndUpdate(fetches, (n) => n + 1),
								(n) => (n === 0 ? Effect.never : Effect.succeed(Fetched.make({ params })))
							),
						Note: noSave
					})
				}
			);
			yield* Effect.yieldNow;
			yield* loop.dispatch(Requested.make({ params: page }));
			expect(yield* loop.settled).toEqual({ attempts: 0, fetched: true });
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

class Down extends Data.TaggedError('Down')<{ readonly what: string }> {}

/**
 * A fetch Loop whose Note commands are writes, recording into `log` the store's transaction, its
 * saves, the writes and the fetches as they start. `fails` names what fails with `Down`.
 */
const writing = (fails: { load?: true; save?: number; note?: string; fetch?: string } = {}) =>
	Effect.gen(function* () {
		const log: Array<string> = [];
		const note = (entry: string) => Effect.sync(() => void log.push(entry));
		const loop = yield* Loop.make(Fetch.fetch, {
			init: {
				model: Fetch.start,
				commands: [Note.make({ text: 'a' }), fetching, Note.make({ text: 'b' })]
			},
			handler: Fetch.Command.match({
				Fetch: ({ params }) =>
					params.page === fails.fetch
						? Effect.fail(new Down({ what: 'fetch' }))
						: Effect.andThen(note(`fetch ${params.page}`), Effect.never),
				Note: ({ text }) =>
					Loop.write(
						text === fails.note ? Effect.fail(new Down({ what: 'note' })) : note(`note ${text}`)
					)
			}),
			store: {
				load: fails.load
					? Effect.fail(new Down({ what: 'load' }))
					: Effect.andThen(note('load'), Effect.succeedNone),
				save: (model) =>
					model.attempts === fails.save
						? Effect.fail(new Down({ what: 'save' }))
						: note(`save ${model.attempts}`),
				transaction: (effect) =>
					Effect.andThen(note('begin'), effect).pipe(
						Effect.onExit((exit) => note(Exit.isSuccess(exit) ? 'commit' : 'rollback'))
					)
			}
		});
		return { loop, log };
	});

describe('Loop writes and store', () => {
	it.effect(
		'starts in one transaction: load, save, then the writes in order, before any work',
		() =>
			Effect.gen(function* () {
				const { log } = yield* writing();
				yield* Effect.yieldNow;
				expect(log).toEqual(['begin', 'load', 'save 0', 'note a', 'note b', 'commit', 'fetch 1']);
			})
	);

	it.effect('commits each transition with its writes before it publishes the model', () =>
		Effect.gen(function* () {
			const { loop, log } = yield* writing();
			log.length = 0;
			const published: Array<string> = [];
			yield* loop.changes.pipe(
				Stream.runForEach((model) =>
					Effect.sync(() => void published.push(`${model.attempts} after ${log.length}`))
				),
				Effect.forkChild({ startImmediately: true })
			);
			yield* loop.dispatch(Failed.make({ params: { page: '2' } }));
			yield* Effect.yieldNow;
			expect(log).toEqual(['begin', 'save 1', 'note retrying', 'commit', 'fetch 2']);
			expect(published).toEqual(['0 after 0', '1 after 4']);
		})
	);

	it.effect('fails a transition whose write fails, which saves, publishes and starts nothing', () =>
		Effect.gen(function* () {
			const { loop, log } = yield* writing({ note: 'retrying' });
			log.length = 0;
			const failure = yield* Effect.flip(loop.dispatch(Failed.make({ params: { page: '2' } })));
			expect(failure).toEqual(new Down({ what: 'note' }));
			expect(log).toEqual(['begin', 'save 1', 'rollback']);
			expect(yield* loop.model).toEqual(Fetch.start);
		})
	);

	it.effect('fails a transition whose save fails', () =>
		Effect.gen(function* () {
			const { loop, log } = yield* writing({ save: 1 });
			log.length = 0;
			const failure = yield* Effect.flip(loop.dispatch(Failed.make({ params: { page: '2' } })));
			expect(failure).toEqual(new Down({ what: 'save' }));
			expect(log).toEqual(['begin', 'rollback']);
			expect(yield* loop.model).toEqual(Fetch.start);
		})
	);

	it.effect('fails its start when the load fails', () =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(writing({ load: true }))).toEqual(new Down({ what: 'load' }));
		})
	);

	it.effect('fails a command whose message leads to a failing transition', () =>
		Effect.gen(function* () {
			const loop = yield* Loop.make(Fetch.fetch, {
				init: { model: Fetch.start, commands: [fetching] },
				handler: Fetch.Command.match({
					Fetch: ({ params }) => Effect.succeed(Failed.make({ params })),
					Note: () => Loop.write(Effect.fail(new Down({ what: 'note' })))
				})
			});
			expect(yield* Effect.flip(loop.join)).toEqual(new Down({ what: 'note' }));
			expect(yield* loop.model).toEqual(Fetch.start);
		})
	);
});

describe('Loop settled', () => {
	it.effect('gives the model at once when no command runs', () =>
		Effect.gen(function* () {
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({ Ask: () => Effect.never, SaveTurn: noSave })
			});
			expect(yield* loop.settled).toEqual(ready(2));
		})
	);

	it.effect('waits for every reply and the commands it leads to', () =>
		Effect.gen(function* () {
			const saved = yield* Ref.make(0);
			const loop = yield* Loop.make(chat, {
				init: { model: ready(2) },
				handler: Command.match({
					Ask: ({ turn }) =>
						Effect.andThen(Effect.yieldNow, Effect.succeed(Answered.make({ turn, left: 1 }))),
					SaveTurn: () =>
						Effect.andThen(
							Effect.yieldNow,
							Ref.update(saved, (n) => n + 1)
						)
				})
			});
			yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
			expect(yield* loop.settled).toEqual(
				Chat.cases.Ready.make({
					turns: [{ id: 't1', question: 'Why Effect?', answer: '' }],
					left: 1
				})
			);
			expect(yield* Ref.get(saved)).toBe(1);
		})
	);

	it.effect('waits for the command a reply starts as it cancels its own', () =>
		Effect.gen(function* () {
			const noting = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const loop = yield* Loop.make(Fetch.fetch, {
				init: { model: Fetch.start, commands: [fetching] },
				handler: Fetch.Command.match({
					// Fetched cancels this Fetch and starts Note.
					Fetch: ({ params }) => Effect.succeed(Fetched.make({ params })),
					Note: () => Effect.andThen(Deferred.succeed(noting, undefined), Deferred.await(release))
				})
			});
			const waiting = yield* Effect.forkChild(loop.settled, { startImmediately: true });
			yield* Deferred.await(noting);
			yield* Effect.yieldNow;
			expect(waiting.pollUnsafe()).toBeUndefined();
			yield* Deferred.succeed(release, undefined);
			expect(yield* Fiber.join(waiting)).toEqual({ attempts: 0, fetched: true });
		})
	);

	it.effect('fails as soon as a command fails while another still runs', () =>
		Effect.gen(function* () {
			const { loop } = yield* writing({ fetch: '2' });
			yield* loop.dispatch(Requested.make({ params: { page: '2' } }));
			expect(yield* Effect.flip(loop.settled)).toEqual(new Down({ what: 'fetch' }));
		})
	);

	it.effect('fails with a command that failed before it was awaited', () =>
		Effect.gen(function* () {
			const loop = yield* Loop.make(Fetch.fetch, {
				init: { model: Fetch.start, commands: [fetching] },
				handler: Fetch.Command.match({
					Fetch: () => Effect.fail(new Down({ what: 'fetch' })),
					Note: noSave
				})
			});
			yield* Effect.yieldNow;
			expect(yield* Effect.flip(loop.settled)).toEqual(new Down({ what: 'fetch' }));
		})
	);
});

describe('Loop.run', () => {
	it.effect('dispatches its messages in order and gives the settled model', () =>
		Effect.gen(function* () {
			const applied: Array<string> = [];
			const model = yield* Loop.run(
				{
					...Fetch.fetch,
					update: (current: Fetch.Model, message: Fetch.Message) => {
						applied.push(`${message._tag} ${message.params.page}`);
						return Fetch.fetch.update(current, message);
					}
				},
				{
					init: { model: Fetch.start },
					handler: Fetch.Command.match({
						Fetch: ({ params }) => Effect.succeed(Fetched.make({ params })),
						Note: noSave
					}),
					messages: [Failed.make({ params: page }), Requested.make({ params: { page: '2' } })]
				}
			);
			expect(model).toEqual({ attempts: 1, fetched: true });
			expect(applied.filter((entry) => !entry.startsWith('Fetched'))).toEqual([
				'Failed 1',
				'Requested 2'
			]);
		})
	);

	it.effect('runs its start alone without messages', () =>
		Effect.gen(function* () {
			const model = yield* Loop.run(Fetch.fetch, {
				init: { model: Fetch.start, commands: [fetching] },
				handler: Fetch.Command.match({
					Fetch: ({ params }) => Effect.succeed(Fetched.make({ params })),
					Note: noSave
				})
			});
			expect(model).toEqual({ attempts: 0, fetched: true });
		})
	);

	it.effect('fails with a command failure and interrupts the commands still running', () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			const failure = yield* Effect.flip(
				Loop.run(Fetch.fetch, {
					init: { model: Fetch.start, commands: [fetching] },
					handler: Fetch.Command.match({
						Fetch: ({ params }) =>
							params.page === '1'
								? hang(started, interrupted)
								: Effect.fail(new Down({ what: 'fetch' })),
						Note: noSave
					}),
					messages: [Requested.make({ params: { page: '2' } })]
				})
			);
			expect(failure).toEqual(new Down({ what: 'fetch' }));
			expect(yield* Deferred.isDone(interrupted)).toBe(true);
		})
	);

	it.effect('dispatches no message after a command failed', () =>
		Effect.gen(function* () {
			const written: Array<string> = [];
			const failure = yield* Effect.flip(
				Loop.run(Fetch.fetch, {
					init: { model: Fetch.start, commands: [fetching] },
					handler: Fetch.Command.match({
						Fetch: () => Effect.fail(new Down({ what: 'fetch' })),
						Note: ({ text }) => Loop.write(Effect.sync(() => void written.push(text)))
					}),
					messages: [Fetched.make({ params: page }), Fetched.make({ params: page })]
				})
			);
			expect(failure).toEqual(new Down({ what: 'fetch' }));
			expect(written).toEqual([]);
		})
	);

	it.effect('runs its commands in the span Loop.run', () =>
		Effect.gen(function* () {
			const spans: Array<string> = [];
			yield* Loop.run(Fetch.fetch, {
				init: { model: Fetch.start, commands: [fetching] },
				handler: Fetch.Command.match({
					Fetch: ({ params }) =>
						Effect.map(Effect.currentSpan, (span) => {
							spans.push(span.name);
							return Fetched.make({ params });
						}),
					Note: noSave
				})
			});
			expect(spans).toEqual(['Loop.run']);
		})
	);
});
