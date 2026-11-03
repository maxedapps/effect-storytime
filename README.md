# effect-storytime

Effect-native story testing. You write behaviour as pure state machines whose side effects are Schema data, then tell **stories** about them: start from a model, send messages and name every command it asks for. Every story runs with strict checks, explorations generate and shrink stories for you, and each test run can write a deterministic JSON record of every story it told.

- **Program**: `update(model, message) ⇒ { model, commands, cancels }` for UI and workflow state. A **Loop** runs it with Effect.
- **Decider**: `decide(state, input) ⇒ events | rejection` plus `evolve`, for one stored row. `handle` runs it on a **Store** in one transaction.
- **Story**, **Decision** and **Exploration** tell how they behave. **Tale** treats all three alike, and **covers** checks that they touch every case.
- **`effect-storytime/vitest`** registers tales as tests through `@effect/vitest`. **`effect-storytime/reporter`** writes the story record.

It needs `effect` 4.1.2 or newer and, for the adapter and reporter, `vitest` 5.1 and `@effect/vitest` 4.1.2.

## Install

```sh
pnpm add effect-storytime effect
# for the Vitest adapter and the reporter
pnpm add -D vitest @effect/vitest
```

Every module is a namespace of the index and also a subpath:

```ts
import { Program, Story } from 'effect-storytime';
import * as Decision from 'effect-storytime/Decision';
```

## Program

A Program is a pure state machine. Its `Model`, `Message` and `Command` are Schemas; `Message` and `Command` are tagged unions such as `Schema.TaggedUnion`.

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

## Story

A story is data: a title, its Program and steps. `Story.run` checks it and gives the final model, the final model as a line and the cases it touched.

```ts
import { Story } from 'effect-storytime';

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

- every input and every produced model, command and event satisfies its Schema;
- `update`, `decide` and `evolve` are pure: each runs twice, its input must not change and both results must be equal (a throw fails the step);
- the model or state, and every message, input and event, round-trips through JSON text by its Schema unchanged, and the run continues from that copy, so a callback that mutates a value it shares with the tale never changes the tale or the run;
- the invariants hold;
- every produced command is owed an assertion until a `commands`, `resolve` or `emit` step names it. A cancel or restart that drops an owed command fails, and so does a story that ends with one, in every order of an `anyOrder`.

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

## Decider and Decision

A Decider rules one stored row. `Decider.handle` loads the state (or `initial`), decides, folds the events and saves, in one transaction of a `Decider.Store` your app provides as a `Context.Service`.

```ts
import { Result, Schema } from 'effect';
import { Decider, Decision } from 'effect-storytime';

export const membership = Decider.make({
	State: Membership, // a Schema; codecs such as Schema.BooleanFromBit work
	Input,
	Event,
	Rejection,
	initial: { source: 'teachable', active: false, checkedAt: null },
	decide: (state, input) =>
		Input.match(input, {
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
		})
});

const grant = Decider.handle(membership, Memberships); // (key, input) ⇒ Effect<events, Rejection | E, Memberships>

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

Every `when` is followed by `accepted(...events)` (exact and ordered; `accepted()` means none) or `rejected(rejection)`. `state(expected)` and `satisfies(label, check)` check the state. `Decision.run` checks a decision in memory; `Decision.against(decision, Memberships, key)` runs the same steps through `handle` on a real Store, so a database layer is tested by the same decision.

## Exploration

An exploration generates stories: random paths of sends, command answers and restarts, each checked with every strict rule except command assertions (a path asserts no effects, so it owes none). A failing path shrinks to a short story, its counterexample.

```ts
import { Arbitrary, Schema } from 'effect';
import { Exploration } from 'effect-storytime';

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

A failure's `counterexample` holds the shrunk path as story lines, `step` numbers the line that failed and `replay` is a token: `Exploration.check(talks, { replay })` checks exactly that path again.

## Tale and covers

A tale is a story, an exploration or a decision. `Tale.lines(tale)` and `Tale.run(tale)` work on any of them. `Tale.covers(program, tales)` runs a Program's stories and explorations and fails with `Tale.Uncovered { missing }` unless together they send, produce or reach every Message, Command and (for a tagged union) Model case.

## Vitest

```ts
import { describe, layer } from '@effect/vitest';
import { covers, stories, tell } from 'effect-storytime/vitest';
import { Decision } from 'effect-storytime';

describe('chat', () => {
	// One test per tale, named by its title.
	stories(answers, stops, talks, lifecycle);
	// One test: the tales touch every case.
	covers(chat, [answers, stops, talks]);
});

layer(Memberships.layer)('memberships in the database', (it) => {
	it.effect('a membership is granted once and revoked once', (ctx) =>
		tell(ctx, lifecycle, Decision.against(lifecycle, Memberships, 'user-1'))
	);
});
```

`tell(ctx, tale, run?)` runs a tale (or `run`, when it needs services), records it in the test's meta and fails the test on a failure.

## The story record

Add the reporter and every run writes `stories.json` (or `outputFile`, relative to the Vitest root):

```ts
// vitest.config.ts
import { StoryReporter } from 'effect-storytime/reporter';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: { reporters: ['default', new StoryReporter({ outputFile: 'reports/stories.json' })] }
});
```

The same tests give the same bytes: records are sorted by file and then test name, paths are posix and relative to the Vitest root, and there are no timings. A report is `{ "version": 1, "stories": [...] }`, one record per told tale:

| Field | Meaning |
| --- | --- |
| `kind` | `Story`, `Exploration` or `Decision` |
| `title` | the tale's title |
| `file`, `test` | the test file and the test's full name (suites joined by ` > `) |
| `lines` | the tale's lines; an exploration has one line naming its runs, steps and seed |
| `status` | `passed` or `failed` |
| `final` | the final model or state as a line, once a story or decision passed |
| `cases` | the cases a passing story or exploration sent, produced or reached |
| `failure` | for a `StoryFailure`: `step`, `line`, `message`, `expected?`, `actual?` and, for an exploration, `counterexample` (the shrunk story's lines, which `step` numbers) and `replay` |

A tale that failed with another error (such as a database error in `Decision.against`) has only `status: "failed"`. [`test/fixtures/report.json`](test/fixtures/report.json) is a full example.

Read a report back with its Schema, which rejects other versions:

```ts
import { Effect, FileSystem } from 'effect';
import { StoryRecord } from 'effect-storytime';

export const report = Effect.flatMap(FileSystem.FileSystem, (fs) =>
	fs.readFileString('reports/stories.json')
).pipe(Effect.flatMap(StoryRecord.decode));
```

## Development

`pnpm check` is the gate: formatting, lint, types, tests at 100% coverage, a 100% mutation score with Stryker and the build. AGENTS.md has the rest.

## License

MIT
