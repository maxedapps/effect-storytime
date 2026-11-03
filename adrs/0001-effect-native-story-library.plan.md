# 0001 Effect-native story library: plan

ADR: [0001-effect-native-story-library.md](0001-effect-native-story-library.md). Task 2309.

## Goal

A private, standalone Effect 4 library, `effect-storytime`, that infinite can pin at `v0.1.0`. It lets you write pure state machines whose side effects are typed data and test them as strict stories:

- `Program` for clients and Durable Objects, `Decider` for row-shaped server rules;
- a production runner for each: `Loop` and `Decider.handle`;
- story and decision runners that return Effects;
- generated stories with shrinking;
- an optional Vitest adapter;
- a deterministic JSON story record that infinite's `pnpm review` can join with its own coverage and mutation results.

The library meets its own bar: 100% coverage, 100% mutation score, and type-aware lint with anti-slop, all inside `pnpm check`.

## Non-goals

- Migrating infinite's tests (infinite's orchestrator does that, task 2309), and infinite's `pnpm review` Stories section.
- Views or Svelte bindings, storage implementations, event sourcing, timers or subscriptions (a timer is a command), and devtools.
- npm publishing or a public repo.
- Two items from 2294's plan:
  - `terminal` is dropped. "A restart never strands work" is an invariant over the model, e.g. `resumable: (m) => isDone(m) || resume(m).commands.length > 0`, so it needs no API of its own.
  - `cancelled(cmd)` is dropped. The next `commands(...)` already shows the command is gone.

## API (0.1)

Each module is a namespace in the index (`import { Story } from 'effect-storytime'`) and also its own subpath (`effect-storytime/Story`). The adapter and reporter live at `effect-storytime/vitest` and `effect-storytime/reporter`.

### Program

```ts
Program.make({ Model, Message, Command, update, resume?, invariants? })
```

- `Model`, `Message` and `Command` are Schemas without services. `Message` and `Command` are tagged unions.
- `update(model, message) ⇒ { model, commands?, cancels? }`.
- `resume(model) ⇒ Next`. It defaults to `{ model }`.
- `invariants` is a record of named predicates.

### Loop

```ts
Loop.make(program, { init, handler, persist? }) ⇒ Effect<Loop<M, Msg>, never, Scope | R>
```

- `handler` is `(cmd) ⇒ Effect<Msg | void, never, R>` or `Stream<Msg, never, R>`, written with the Command union's exhaustive `match` (no type assertion needed for a per-tag record).
- `persist` is `{ load: Effect<Option<M>, never, R>, save: (m) ⇒ Effect<void, never, R> }`.
- One `apply(next)`, used on start and on every dispatch, runs in this order:
  1. save;
  2. set the `SubscriptionRef`;
  3. interrupt the cancels;
  4. fork the commands into a `FiberMap` keyed by their canonical JSON (the Schema JSON encoding with sorted object keys). Stories and the record use the same key.
- On start it applies `resume(stored)` if a model was stored, otherwise `init`.
- `dispatch` puts the message on a queue and waits until it is applied. One consumer fiber runs `update` and `apply` for each message in turn; command fibers only enqueue, so a command that its own message cancels or replaces never interrupts the apply (tests: a final stream message that cancels its command and starts another; a retry reply that replaces its command and starts a second one).
- The `Loop` exposes `dispatch(msg)`, `model` (an Effect) and `changes` (a Stream).

### Decider

```ts
Decider.make({ State, Input, Event, Rejection, initial, decide, evolve, invariants? })
```

- `decide(state, input) ⇒ Result<ReadonlyArray<Event>, Rejection>`.
- `evolve(state, event) ⇒ state`.
- `Decider.Store<Key, State, Event, E>` is the interface: `load(key)`, `save(key, state, events)` and `transaction(effect)`. An app implements it as a `Context.Service`.
- `Decider.handle(decider, StoreTag) ⇒ (key, input) ⇒ Effect<ReadonlyArray<Event>, Rejection | E, Id>`. Inside the transaction it loads the state (falling back to `initial`), decides, folds the events and saves, but only if there are events.

### Story

```ts
Story.make(title, program, ...steps)
```

- Steps are tagged data:
  - `given(model)` comes first and appears once.
  - `send(msg)` runs `update`.
  - `model(expected)` requires the model to equal `expected` (by canonical JSON); `satisfies(label, check)` requires a check, shown in lines by its label so lines stay deterministic.
  - `commands(...cmds)` requires the pending set to be exactly these; `commands()` means none.
  - `resolve(cmd, msg?)` takes a pending command away and feeds its message, if any.
  - `emit(cmd, msg)` feeds a message from a pending streaming command, which stays pending.
  - `restart()` round-trips the model through JSON, drops every pending command and applies `resume`.
  - `anyOrder(...2–5 steps)` runs the rest of the story once per order; a `steps(...)` group inside it moves as one unit. A `resolve` or `emit` is skipped only if its command was cancelled earlier in the same order; any other missing command fails as usual.
  - `steps(...)` groups steps, so stories can share a part.
- Every produced command is owed an assertion until a `commands`, `resolve` or `emit` step names it. A step that drops an owed command (a cancel, a restart) fails, so no effect leaves the story unasserted. Inside `anyOrder` a cancel may drop one: a command only one order produces cannot be named by the shared steps.
- Steps type-check against the program through contextual inference.
- `Story.run(story) ⇒ Effect<Outcome, StoryFailure>`. `Outcome` holds the final model and the cases touched.
- `Story.explore(title, program, { given: Arbitrary<M>, send: Arbitrary<Msg>, replies?, restarts?, runs?, steps?, seed? })` returns an `Exploration`. A generated path checks everything below except command assertions: it asserts no effects, so commands may be pending at its end and none is owed.
  - The generated actions are `Send`, `Reply { pick, choice }` and `Restart`.
  - `replies: { [Tag]?: (cmd) ⇒ ReadonlyArray<Msg> }` lists the messages a pending command may answer with. Indices wrap around, which keeps shrinking simple.
  - The seed defaults to the title.
  - `Story.check(exploration, { replay? }) ⇒ Effect<Outcome, StoryFailure>` runs `Arbitrary.checkEffect`. A failure carries the shrunk path as story lines plus the replay token, which `replay` takes back to rerun exactly that path.
- `Story.covers(program, stories) ⇒ Effect<void, StoryFailure>` requires every Message, Command and (tagged) Model case to be sent, produced or reached.
- `Story.lines(story | exploration)` renders plain lines from the value alone.

### Decision

```ts
Decision.make(title, decider, ...steps)
```

- The steps are `given(state)` (first and once), `when(input)`, `accepted(...events)` (exact and ordered; `accepted()` means none), `rejected(r)`, `state(expected)` and `satisfies(label, check)`.
- Every `when` is followed right away by an `accepted` or `rejected`.
- `Decision.run(d) ⇒ Effect<Outcome, StoryFailure>`.
- `Decision.against(d, StoreTag, key) ⇒ Effect<Outcome, StoryFailure | E, Id>` runs the same steps through `handle` on a real Store: it seeds `given` with `save` and checks `state` with `load`.
- `Decision.lines(d)` renders plain lines.

### Strict checks in every run

These apply to stories, explored paths and decisions alike:

- Every step's input and every produced value must satisfy its Schema's Type side (`Schema.is`, so codecs such as `BooleanFromBit` work).
- `update`, `decide` and `evolve` run twice. The canonical JSON of the input must be the same before and after each run, and the two results' canonical JSON, each taken right after its run, must be equal. That catches mutation (also of a `Date` or `Map`) and hidden state without freezing values. A throw fails the step as a `StoryFailure`, also inside `explore`, where it shrinks.
- The model or state must round-trip through `Schema.toCodecJson`.
- The invariants must hold.
- In authored stories and decisions, no owed command may remain at the end.

### StoryFailure

`StoryFailure` is a `Schema.TaggedError` carrying:

- the title;
- the step number and that step's line;
- the message;
- `expected` and `actual` as encoded JSON, which Vitest diffs;
- for explorations, the counterexample lines and the replay token.

### StoryRecord

The Schemas `StoryRecord` and `StoryReport`. A report is `{ version: 1, stories }` and is documented in the README.

Each record holds:

- `kind`: `story`, `decision` or `exploration`;
- `title`, `file` (posix, relative to the Vitest root) and `test` (Vitest's full name);
- `lines`;
- `status`: `passed` or `failed`;
- `final`: the final model or state as one JSON line;
- `failure`: `{ step, message, counterexample, replay }`;
- `cases`: the tags touched.

Records are sorted by file, then test, and carry no timings or absolute paths.

### Vitest and reporter

- `effect-storytime/vitest`:
  - `stories(...tales)` registers one `it.effect` per tale, named by its title.
  - `covers(program, stories)` registers one test.
  - `tell(ctx, tale, run?)` runs any tale (also `Decision.against` inside a `layer(...)`), puts its record into `ctx.task.meta.storytime` and fails the test on a `StoryFailure`.
- `effect-storytime/reporter`: a Vitest reporter that writes the `StoryReport` to `outputFile` (default `stories.json`) in `onTestRunEnd`.

## Tasks

1. **Repo config.** Done when `pnpm check` runs green on an empty `src/index.ts` with a smoke test.
   - `tsconfig.json` (infinite's strict base, with the `@effect/tsgo` plugin) and `tsconfig.build.json` (emits `dist/` with declarations and `rewriteRelativeImportExtensions`).
   - `.oxlintrc.json`, modelled on infinite's (Effect presets, type-aware, `denyWarnings`, vitest rules). Anti-slop is vendored into `tools/oxlint/anti-slop` with `UPSTREAM.md` and `LICENSE`.
   - `.oxfmtrc.json` (infinite's style).
   - `vitest.config.ts` (v8 coverage, 100% thresholds on `src`).
   - `stryker.config.json` (vitest runner, `break: 100`, incremental off).
   - Scripts: `format`, `lint`, `typecheck`, `test`, `mutate`, `build` and `check` (all of them).
2. **Program and Loop**, tested with `@effect/vitest`:
   - commands run and feed messages back;
   - a stream handler emits several messages;
   - a cancel interrupts the command;
   - an identical command replaces the running one;
   - `persist` saves before commands run (an order log);
   - a restart from a stored model runs `resume`;
   - `changes` emits;
   - scope close interrupts.
3. **Story core**: `given`, `send`, `model`, `commands`, `resolve`, `emit`, `steps`, the strict checks, `StoryFailure` and `lines`. There is one test per rule that fails without it, each with the failing message checked. The example program is a Chat modelled on infinite's `chat.svelte.ts`: asking, busy, streaming answer events and refusals.
4. **`restart` and `anyOrder`**, with a Conversation-shaped example: phases, `resume` redoing the step, and recall cancelling the running step in either order.
5. **Decider, `handle`, Decision and `against`**: a membership-shaped example whose State uses a real codec (`Schema.BooleanFromBit`, as infinite's memberships do), with an in-memory Store layer that records its transactions.
6. **`explore` and `covers`**:
   - a seeded, deterministic run that passes;
   - a planted bug that is found, shrunk to a minimal path (lines checked) and reproduced from its replay token;
   - a throwing `update` that is found and shrunk too;
   - a Program whose path ends with a command in flight passes;
   - `covers` naming the missing cases.
7. **StoryRecord, the Vitest adapter and the reporter**. Tested by running Vitest programmatically (`startVitest` from `vitest/node`) on fixture story files in two projects, with a passing and a failing story and a failing exploration, then decoding the written report (repository-relative paths, diagnostics, replay token) and checking it stays byte-identical across two runs.
8. **README** (concepts, examples for each step, Loop, Decider, explore, Vitest, the record format, consuming via a git tag) and **AGENTS.md** with the gate and landing (create-skill), plus a `CLAUDE.md` symlink.
9. **Release**:
   - `pnpm release 0.1.0`: a script that builds, commits `dist/` on a detached commit on top of main, tags `v0.1.0` and pushes the tag.
   - Verify the tag from scratch: in `~/tmp`, run `pnpm add github:maxedapps/effect-storytime#v0.1.0` and import every entry point in a Node script and a Vitest file.
   - Give infinite's GitHub account (maxschwarzmueller) read access if it lacks it, and confirm the repo is still private.

## Evidence

No UI. My person gets:

- the gate numbers: tests, coverage, the mutation score with mutant counts, and the time;
- a sample `stories.json` from the fixture run;
- a failing story's Vitest output with its diff;
- a shrunk explore counterexample;
- the scratch install of `v0.1.0`;
- key excerpts from the landed commit.

## Open questions

- None block 0.1. infinite is on `effect` 4.0.6; the library's peer range is `^4.1.2` (the version it is tested against), so infinite's move to 4.1 (task 2284) comes first. That is noted in the report, not a question for Max.

## Settled findings

Plan review, round 1 (Codex GPT-6.1 Sol):

- high bug: a command's own reply that cancels or replaces it interrupts `apply` before the follow-up commands start — fixed: one consumer fiber applies queued messages and command fibers only enqueue (already so in the first Loop draft); tests for a self-cancelling final stream message and a self-replacing retry, each also starting another command.
- high bug: the strict end rule fails generated paths that stop with work in flight — fixed: explored paths check schemas, purity, round trips, invariants and restarts, never command assertions; a passing Ask/Fetch exploration ending after Send is a test.
- high bug: an unasserted command dropped by a restart or cancel escapes the end check — fixed: every produced command is owed until a step names it, and dropping an owed one fails that step; tests for both.
- medium bug: JSON-string keys and Schema equivalence disagree on records with reordered keys — fixed: one canonical JSON (sorted keys) is the command identity in Loop and Story and the record's serializer; parity tests with reordered `Schema.Record` payloads.
- medium bug: `anyOrder` skips any vanished command, masking a double resolve — fixed: a reply is skipped only when its command was cancelled earlier in the same order; a duplicate completion fails.
- medium simplification: deep freeze plus comparing live results misses `Date`/`Map` mutation, and throws escape `checkEffect` as defects — fixed: compare canonical JSON of input before/after and of each result right after its run, validate with `Schema.is`, turn throws into `StoryFailure`; a codec model fixture and a `Date` mutation regression.
- medium bug: the replay token cannot be passed back — fixed: `Story.check(exploration, { replay })` passes `CheckOptions.replay`; a test reproduces the shrunk path from it.

Implementation amendments (to raise at the code review):

- The owed rule meets `anyOrder`: a step after one order's reply cannot name a command that only that order started, so a cancel inside `anyOrder` may drop an owed command; outside it and at a restart the rule stands. Test: a recall in either order with the next step started in one of them.
- `satisfies` takes a label: a check's source text changes under bundlers and Stryker, which would break the deterministic record.
- Decision's `then` is `accepted`: a module exporting `then` is a thenable namespace, so `await import('effect-storytime/Decision')` would call it. `state(predicate)` became `satisfies(label, check)`, as in Story, so lines stay deterministic.
- Explorations are their own module: `Exploration.make(title, program, { given, send?, replies?, emits?, restarts?, runs?, steps?, seed? })`, `Exploration.check(exploration, { replay? }) ⇒ Effect<Explored, StoryFailure>` and `Exploration.lines`. Inside `Story` they would make `Story` and `Exploration` import each other. `send` defaults to the Message Schema's Arbitrary; `replies` and `emits` are functions of the command, since a tag map adds nothing a `guards` check doesn't. A failure's `line` is the exploration's own line and `step` numbers the counterexample line that failed.
- Story and explored paths share one set of step rules (`internal/machine.ts`); explored paths owe no command.
- `covers` lives in a `Tale` module with `Tale.lines`, `Tale.run` and `Tale.cases`: a tale is a story, exploration or decision, implementing one symbol-keyed method, so records and the adapter take tales of any Program or Decider without `any`. Missing cases fail with `Tale.Uncovered { missing }`. Outcomes carry `final`, the final model or state as a line, for the record.
