# effect-storytime

Lean domain modelling for Effect 4. You write the domain as pure state machines whose inputs, outputs and side effects are Schema data, then tell **stories** about them that run with strict checks, shrink generated counterexamples and write a deterministic record of every tale a test run told.

The root entry is the domain:

- **Decider**: `decide(state, command) ⇒ events | rejection`, `evolve` and named invariants: the command side of a consistency boundary. `handle` runs it on a **Store** in one transaction, which makes it an aggregate.
- **Program**: `update(model, message) ⇒ { model, commands, cancels }` for processes and UI state. A **Loop** runs it with Effect.

**`effect-storytime/testing`** tells how they behave:

- **Story**, **Decision** and **Exploration** are tales about Programs and Deciders. **Tale** treats all three alike, and **covers** checks that they touch every case.
- **StoryRecord** is the Schema of the record, and **Vitest** registers tales as tests through `@effect/vitest` and writes the record.

The domain imports nothing from `testing`, so production code loads none of it. The only dependency is the `effect` peer (4.1.2 or newer); the testing entry also needs `vitest` 5.1 and `@effect/vitest` 4.1.2, which are optional peers.

## Install

Install it from its git tag, which carries the built `dist/`, so installing runs no build. Pin it in your pnpm catalog:

```yaml
# pnpm-workspace.yaml
catalog:
  effect-storytime: github:maxedapps/effect-storytime#v0.3.0
```

Add `effect` beside it and, where you test, `vitest` and `@effect/vitest`.

```ts
import { Decider, Loop, Program } from 'effect-storytime';
import { Decision, Exploration, Story, StoryRecord, Tale, Vitest } from 'effect-storytime/testing';
```

## Decider

A Decider owns the rules of one consistency boundary: a membership, an order, a learner's progress in a course. Its `State`, `Command`, `Event` and `Rejection` are Schemas, the last three usually tagged unions. `decide` is pure: time, ids and the acting user go into the command.

```ts
import { Result, Schema } from 'effect';
import { Decider } from 'effect-storytime';

export const membership = Decider.make({
	State: Membership, // a Schema; codecs such as Schema.BooleanFromBit work
	Command, // Grant | Revoke
	Event, // Granted | Revoked
	Rejection, // AlreadyActive | NotActive
	initial: { source: 'teachable', active: false, checkedAt: null },
	decide: (state, command) =>
		Command.match(command, {
			Grant: ({ source, at }) =>
				state.active
					? Result.fail(AlreadyActive.make({ since: state.checkedAt }))
					: Result.succeed([Granted.make({ source, at })]),
			Revoke: () =>
				state.active ? Result.succeed([Revoked.make({})]) : Result.fail(NotActive.make({}))
		}),
	evolve: (state, event) =>
		Event.match(event, {
			Granted: ({ source, at }) => ({ source, active: true, checkedAt: at }),
			Revoked: () => ({ ...state, active: false })
		}),
	// Named predicates every state must satisfy.
	invariants: { checkedWhenActive: (state) => !state.active || state.checkedAt !== null }
});
```

`Decider.handle(decider, Store)` loads the state under a key (or `initial`), decides, folds the events, checks the invariants on the state they reach and saves, all in one transaction of a `Decider.Store` your app provides as a `Context.Service`:

```ts
const grant = Decider.handle(membership, Memberships);

const { events, state } = yield* grant('user-1', Grant.make({ source: 'teachable', at }));
// grant: (key, command) ⇒ Effect<{ events, state }, AlreadyActive | NotActive | SqlError, Memberships>
```

It resolves after the commit with the events and the state they reached. A rejection fails the Effect, so callers narrow it with `Effect.catchTag`, and nothing is saved. A command that gives no events saves nothing and returns the loaded state. When the events reach a state that breaks an invariant, `handle` dies with `Decider.InvariantBroken { invariant, state }` inside the transaction, so that state is never written.

### The Store

A Store has three operations: `load(key)` gives the saved state or none, `save(key, state, events)` writes it and `transaction(effect)` runs `handle`'s load, decide and save as one unit. The state may live in one row or several tables, and `save` gets the events too, so a Store may keep a history. `handle` relies on three promises:

- **Isolation**: `transaction` protects everything `load` read until `save` commits, so two concurrent commands never both decide on the same state. Use SERIALIZABLE transactions with retries, or guard the writes with a version column.
- **Round trip**: `load` gives back exactly what `save` stored.
- **Commit**: `transaction` is the outermost transaction, so `handle` resolves only once its writes are committed. Don't call `handle` inside another transaction: a nested one becomes a savepoint, which keeps the outer isolation level, commits only with the outer transaction and cannot be retried on its own.

With `effect/sql`:

```ts
import { Context, Effect, Layer, Schema } from 'effect';
import { SqlClient, SqlError, SqlSchema } from 'effect/sql';
import { Decider } from 'effect-storytime';

const Row = Schema.Struct({ ...Membership.fields, userId: Schema.String });

export class Memberships extends Context.Service<
	Memberships,
	Decider.Store<string, Membership, Event, SqlError.SqlError | Schema.SchemaError>
>()('Memberships') {
	static readonly layer = Layer.effect(
		Memberships,
		Effect.gen(function* () {
			// A client that maps camelCase fields to snake_case columns and back.
			const sql = yield* SqlClient.SqlClient;
			const find = SqlSchema.findOneOption({
				Request: Schema.String,
				Result: Membership,
				execute: (userId) =>
					sql`SELECT source, active, checked_at FROM memberships WHERE user_id = ${userId}`
			});
			return Memberships.of({
				load: find,
				save: (userId, state, events) =>
					Effect.gen(function* () {
						const row = yield* Schema.encodeEffect(Row)({ ...state, userId });
						yield* sql`INSERT INTO memberships ${sql.insert(row)}
							ON CONFLICT (user_id) DO UPDATE SET ${sql.update(row, ['userId'])}`;
						yield* Effect.forEach(
							events,
							(event) => sql`INSERT INTO membership_history ${sql.insert({ userId, kind: event._tag })}`,
							{ discard: true }
						);
					}),
				transaction: (effect) =>
					sql.withTransaction(effect).pipe(
						Effect.provideService(SqlClient.BeginTransaction, 'BEGIN ISOLATION LEVEL SERIALIZABLE'),
						Effect.retry({
							while: (error) =>
								SqlError.isSqlError(error) &&
								(error.reason._tag === 'SerializationError' || error.reason._tag === 'DeadlockError'),
							times: 5
						})
					)
			});
		})
	);
}
```

A retry runs `decide` again on the freshly loaded state, which is safe because it is pure.

## Program

A Program is a pure state machine for a process or a screen. Its `Model`, `Message` and `Command` are Schemas; `Message` and `Command` are tagged unions such as `Schema.TaggedUnion`.

```ts
import { Schema } from 'effect';
import { Program } from 'effect-storytime';

export const Chat = Schema.TaggedUnion({
	Ready: { left: Schema.Int },
	Asking: { left: Schema.Int, turn: Schema.String, question: Schema.String, answer: Schema.String }
});
export const Message = Schema.TaggedUnion({
	Asked: { turn: Schema.String, text: Schema.String },
	Delta: { turn: Schema.String, text: Schema.String },
	Answered: { turn: Schema.String, left: Schema.Int },
	Stopped: {}
});
export const Command = Schema.TaggedUnion({
	Ask: { turn: Schema.String, text: Schema.String }
});
const { Ready, Asking } = Chat.cases;
const { Ask } = Command.cases;

export const chat = Program.make({
	Model: Chat,
	Message,
	Command,
	update: (model, message) =>
		Message.match(message, {
			Asked: ({ turn, text }) =>
				Chat.guards.Ready(model)
					? {
							model: Asking.make({ left: model.left, turn, question: text, answer: '' }),
							commands: [Ask.make({ turn, text })]
						}
					: { model },
			Delta: ({ turn, text }) =>
				Chat.guards.Asking(model) && model.turn === turn
					? { model: Asking.make({ ...model, answer: model.answer + text }) }
					: { model },
			Answered: ({ left }) => ({ model: Ready.make({ left }) }),
			Stopped: () =>
				Chat.guards.Asking(model)
					? {
							model: Ready.make({ left: model.left }),
							cancels: [Ask.make({ turn: model.turn, text: model.question })]
						}
					: { model }
		}),
	// What to redo after a restart, from the stored model alone; by default nothing.
	resume: (model) => ({ model }),
	// Named predicates every model must satisfy after every step of every story.
	invariants: { leftIsNeverNegative: (model) => model.left >= 0 }
});
```

A command's identity is its canonical JSON: its Schema's JSON encoding with sorted object keys. An identical command replaces the running one, and `cancels` names the commands to stop.

## Loop

A Loop runs a Program in the current scope. One fiber applies messages in order; commands run as fibers keyed by their canonical JSON and only enqueue the messages they answer with. A message from a command that was cancelled or replaced after it was enqueued is dropped.

```ts
import { Effect, Stream } from 'effect';
import { Loop } from 'effect-storytime';

const program = Effect.scoped(
	Effect.gen(function* () {
		const loop = yield* Loop.make(chat, {
			init: { model: Ready.make({ left: 2 }) },
			// The Command union's exhaustive match: a new command without a handler does not compile.
			handler: Command.match({
				Ask: ({ turn }) =>
					Stream.make(
						Delta.make({ turn, text: 'Typed errors.' }),
						Answered.make({ turn, left: 1 })
					)
			}),
			// Optional: the stored model is resumed on start and saved before commands run.
			persist: { load: loadChat, save: saveChat }
		});
		yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
		// `dispatch` returns once the message is applied; the answer arrives later.
		return yield* loop.changes.pipe(Stream.filter(Chat.guards.Ready), Stream.runHead);
	})
);
```

A handler returns an Effect that may answer with a message, or a Stream of them. Failures must become messages, so the Program decides what they mean. `loop.model` reads the current model and `loop.changes` streams it, starting with the current one.

## Domain modelling

The library keeps to the functional core of Domain-Driven Design and leaves the rest to Effect itself:

| DDD building block | Here |
| --- | --- |
| Aggregate | A Decider plus a Store transaction that protects what it read. There is no aggregate class. |
| Command, event, rejection | Schema tagged unions; `handle` turns a rejection into the typed error. |
| Invariant | A Decider's named predicates, checked by every tale and by `handle` before it saves. |
| Repository | A `Decider.Store` your app implements, on one row or several tables. |
| Process manager | A Program: its model remembers what is under way, its commands drive Deciders. |
| Value object | A Schema with `Schema.brand` and checks, plus plain functions. |
| Port, adapter | A `Context.Service` and its `Layer`. |
| Projection, query | A SQL query in an `Effect.fn`; in memory, `events.reduce(evolve, initial)`. |
| Policy | A plain pure function from an event to commands. |
| Saga, durable workflow | `effect/workflow`, used directly. |
| Agent tool | `effect/ai`'s `Tool` with the command's Schemas, calling `handle`. |
| Bounded context | A package or a folder, kept apart by import rules. |

There is no event store: a Store may keep the events it gets, but the state it saves is the truth. `decide` never runs effects; whatever a decision depends on is in the command or in the state the transaction loaded.

A process manager that has to survive restarts keeps its unfinished work in its model, and `resume` reissues it. The commands it sends must be idempotent at their Decider, by an id in the command:

```ts
export const awarding = Program.make({
	Model: Awarding, // { pending: ReadonlyArray<Award> }
	Message, // LecturesCompleted | Awarded
	Command: Award, // { id, learner, badge }; the badges Decider rejects an id it saw as AlreadyAwarded
	update: (model, message) =>
		Message.match(message, {
			LecturesCompleted: (completed) => {
				const awards = awardsFor(completed);
				return { model: { pending: [...model.pending, ...awards] }, commands: awards };
			},
			Awarded: ({ id }) => ({ model: { pending: model.pending.filter((award) => award.id !== id) } })
		}),
	resume: (model) => ({ model, commands: model.pending })
});
```

Its handler calls `Decider.handle` for each `Award`. With `persist`, a Loop saves the model before it starts the commands, so after a crash `resume` reissues every award still pending. What the Loop cannot recover is a message that never reached it: when the lectures Decider commits and the process crashes before `LecturesCompleted` is dispatched, nothing remembers it. Where that gap matters, write the message in the same transaction as the commit (an outbox) and deliver it from there, or run the process with `effect/workflow`.

## Story

The tales live in `effect-storytime/testing`. A story is data: a title, its Program and steps. `Story.run` checks it and gives the final model, the final model as a line and the cases it touched.

```ts
import { Story } from 'effect-storytime/testing';

const { Asked, Delta, Answered } = Message.cases;
const ask = Ask.make({ turn: 't1', text: 'Why Effect?' });

export const answers = Story.make(
	'a question is answered while it streams',
	chat,
	Story.given(Ready.make({ left: 2 })),
	Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	Story.commands(ask),
	Story.emit(ask, Delta.make({ turn: 't1', text: 'Typed errors.' })),
	Story.resolve(ask, Answered.make({ turn: 't1', left: 1 })),
	Story.model(Ready.make({ left: 1 }))
);

Story.lines(answers);
// [
//   'given Ready {"left":2}',
//   'send Asked {"text":"Why Effect?","turn":"t1"}',
//   'commands Ask {"text":"Why Effect?","turn":"t1"}',
//   'emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"Typed errors.","turn":"t1"}',
//   'resolve Ask {"text":"Why Effect?","turn":"t1"} → Answered {"left":1,"turn":"t1"}',
//   'model Ready {"left":1}'
// ]
```

| Step | Meaning |
| --- | --- |
| `given(model)` | Starts the story. It comes first and only once. |
| `send(message)` | Runs `update`. |
| `model(expected)` | The model equals `expected` (by canonical JSON). |
| `satisfies(label, check)` | The model passes `check`; lines show the label. |
| `commands(...commands)` | Exactly these commands are pending, in any order; `commands()` means none. |
| `resolve(command, reply?)` | Completes a pending command and sends its reply, if any. |
| `emit(command, message)` | Sends one message from a pending streaming command, which stays pending. |
| `restart()` | As after a crash: the model round-trips through JSON, pending commands are dropped and `resume` runs. |
| `anyOrder(...steps)` | Runs the rest of the story once per order of these 2 to 5 steps. |
| `steps(...steps)` | Groups steps so stories can share a part; inside `anyOrder` a group moves as one. |

Steps type-check against the Program from `Story.make`'s arguments, without type parameters.

### Strict checks

Every story, explored path and decision is checked at every step:

- every message and Decider command it sends, and every model, command and event produced, satisfies its Schema;
- `update`, `decide` and `evolve` are pure: each runs twice, its input must not change and both results must be equal (a throw fails the step);
- the model or state, and every message, command and event, round-trips through JSON text by its Schema unchanged, and the run continues from that copy, so a callback that mutates a value it shares with the tale never changes the tale or the run;
- the invariants hold;
- every produced Program command is owed an assertion until a `commands`, `resolve` or `emit` step names it. A cancel or restart that drops an owed command fails, and so does a story that ends with one, in every order of an `anyOrder`.

A failure is a `Story.StoryFailure` with the title, the step's number and line, the message and, where they differ, `expected` and `actual` (which Vitest diffs).

### Restart and anyOrder

```ts
export const stops = Story.make(
	'a stop and a late reply land in either order',
	chat,
	Story.given(Ready.make({ left: 2 })),
	Story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	Story.commands(ask),
	Story.anyOrder(
		Story.send(Message.cases.Stopped.make({})),
		Story.resolve(ask, Answered.make({ turn: 't1', left: 1 }))
	),
	Story.commands()
);
```

A `resolve` or `emit` inside `anyOrder` is skipped when its command was cancelled earlier in the same order, as a real reply to a stopped command is dropped.

## Decision

A decision is a story about a Decider: given a state, each command is accepted with its events or rejected.

```ts
import { Decision } from 'effect-storytime/testing';

export const lifecycle = Decision.make(
	'a membership is granted once and revoked once',
	membership,
	Decision.given(membership.initial),
	Decision.when(Grant.make({ source: 'teachable', at: '2026-11-03' })),
	Decision.accepted(Granted.make({ source: 'teachable', at: '2026-11-03' })),
	Decision.when(Grant.make({ source: 'teachable', at: '2026-11-04' })),
	Decision.rejected(AlreadyActive.make({ since: '2026-11-03' })),
	Decision.when(Revoke.make({})),
	Decision.accepted(Revoked.make({})),
	Decision.satisfies('inactive', (state) => !state.active)
);
```

Every `when` is followed by `accepted(...events)` (exact and ordered; `accepted()` means none) or `rejected(rejection)`. `state(expected)` and `satisfies(label, check)` check the state.

`Decision.run` checks a decision in memory. `Decision.against(decision, Memberships, key)` runs the same steps through `handle`'s transaction on a real Store, so a database layer is tested by the same decision. The test arranges the Store's rows first; `given` loads the state under `key` and fails unless it equals the given state. Each `when` decides and saves, and `state` checks what the Store loads back.

## Exploration

An exploration generates tales: random paths through a Program or a Decider, each checked with every strict rule except command assertions (a path asserts no effects, so it owes none). A failing path shrinks to a short story or decision, its counterexample.

A Program's paths send messages, answer pending commands and restart:

```ts
import { Arbitrary, Schema } from 'effect';
import { Exploration } from 'effect-storytime/testing';

export const talks = Exploration.make('a chat talks', chat, {
	given: Arbitrary.Constant(Ready.make({ left: 2 })),
	// By default any message the Message Schema allows.
	send: Arbitrary.map(Arbitrary.schema(Schema.Literals(['t1', 't2'])), (turn) =>
		Asked.make({ turn, text: `question ${turn}` })
	),
	// The messages a pending command completes with; a command with none stays pending.
	replies: (command) => [Answered.make({ turn: command.turn, left: 1 })],
	// The messages a pending command streams while it stays pending.
	emits: (command) => [Delta.make({ turn: command.turn, text: 'hi' })],
	runs: 100, // the default
	steps: 30, // the most actions a path takes; the default
	restarts: true // the default
	// seed: the title by default, so every run checks the same paths
});

const checked = Exploration.check(talks); // Effect<{ runs, cases }, StoryFailure>
```

A Decider's paths decide one command after another, rejections included:

```ts
export const memberships = Exploration.decisions('memberships hold', membership, {
	// Both optional: the Decider's `initial`, and any command the Command Schema allows.
	given: Arbitrary.Constant(membership.initial),
	when: Arbitrary.schema(Command)
	// runs, steps and seed as above
});
```

A failure's `counterexample` holds the shrunk path as story or decision lines, `step` numbers the line that failed and `replay` is a token: `Exploration.check(talks, { replay })` checks exactly that path again.

## Tale and covers

A tale is a story, an exploration or a decision. `Tale.lines(tale)` and `Tale.run(tale)` work on any of them. `Tale.covers(subject, tales)` runs a Program's or a Decider's tales and fails with `Tale.Uncovered { missing }` unless together they touch every case `Tale.cases(subject)` lists: a Program's Message and Command cases and, for a tagged union, its Model cases; a Decider's cases of each of its State, Command, Event and Rejection Schemas that is a tagged union. Only the subject's own tales count; a tale of another Program or Decider touches none of its cases, even where the names match. A Decider's State cases count every state a command's events pass through, not only the last.

## Vitest

```ts
import { describe, layer } from '@effect/vitest';
import { Decision, Vitest } from 'effect-storytime/testing';

describe('chat', () => {
	// One test per tale, named by its title.
	Vitest.stories(answers, stops, talks, lifecycle);
	// One test: the tales touch every case.
	Vitest.covers(chat, [answers, stops, talks]);
	Vitest.covers(membership, [lifecycle, memberships]);
});

layer(Memberships.layer)('memberships in the database', (it) => {
	it.effect('a membership is granted once and revoked once', (ctx) =>
		Vitest.tell(ctx, lifecycle, Decision.against(lifecycle, Memberships, 'user-1'))
	);
});
```

`Vitest.tell(ctx, tale, run?)` runs a tale (or `run`, when it needs services), records it in the test's meta and fails the test on a failure.

## The story record

Add the reporter and every run writes `stories.json` (or `outputFile`, relative to the Vitest root):

```ts
// vitest.config.ts
import { Vitest } from 'effect-storytime/testing';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: { reporters: ['default', new Vitest.Reporter({ outputFile: 'reports/stories.json' })] }
});
```

The same tests give the same bytes: records are sorted by file and then test name, paths are posix and relative to the Vitest root, and there are no timings. A report is `{ "version": 2, "stories": [...] }`, one record per told tale:

| Field | Meaning |
| --- | --- |
| `kind` | `Story`, `Exploration` or `Decision` |
| `title` | the tale's title |
| `file`, `test` | the test file and the test's full name (suites joined by ` > `) |
| `lines` | the tale's lines; an exploration has one line naming its runs, steps and seed |
| `status` | `passed` or `failed` |
| `final` | the final model or state as a line, once a story or decision passed |
| `cases` | the cases a passing tale touched, such as `Message.Asked` or `Command.Grant`: a story's or exploration's messages, commands and models, a decision's or exploration's commands, events, rejections and states |
| `failure` | for a `StoryFailure`: `step`, `line`, `message`, `expected?`, `actual?` and, for an exploration, `counterexample` (the shrunk story's or decision's lines, which `step` numbers) and `replay` |

A tale that failed with another error (such as a database error in `Decision.against`) has only `status: "failed"`. [`test/fixtures/report.json`](test/fixtures/report.json) is a full example.

Read a report back with its Schema, which rejects other versions:

```ts
import { Effect, FileSystem } from 'effect';
import { StoryRecord } from 'effect-storytime/testing';

export const report = Effect.flatMap(FileSystem.FileSystem, (fs) =>
	fs.readFileString('reports/stories.json')
).pipe(Effect.flatMap(StoryRecord.decode));
```

## Development

`pnpm check` is the gate: formatting, lint, types, tests at 100% coverage, a 100% mutation score with Stryker and the build. AGENTS.md has the rest.

## License

MIT
