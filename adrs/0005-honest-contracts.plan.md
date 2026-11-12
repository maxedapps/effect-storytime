# 0005 Honest contracts: plan

ADR: [0005-honest-contracts.md](0005-honest-contracts.md). Task 3293 (Max #46302, #46341). Builds on the readable-failures build (StoryFailure messages, `Story.of`, Loop dispatch-after-close); implementation starts from its commit.

## Goal

Release effect-storytime 0.4.0 with items 1, 2, 4 and 5 of the design review and the audit's `Loop.join`, shrinkable callback failures and `Effect.fn` cleanup, all under the gate (100% coverage and mutation score), README and docs/ matching.

## Non-goals

Startup stories, pipe overloads (`Function.dual`), the reporter on `FileSystem`/`Path`, `ci.yml`, npm publishing.

## Tasks

1. **Invariant boundary.** `src/internal/invariants.ts`: `enforce(invariants, show)` dying with `InvariantBroken`, which Program.ts exports. `Decider.handle` and `Loop.apply` use it (Loop before `save`, `SubscriptionRef.set` and `FiberMap.run`, also for init and resume). Tests (`test/Loop.test.ts`, `test/Decider.test.ts`): a message that breaks an invariant fails its dispatch with `InvariantBroken`, leaves model and store unchanged and starts no command; a breaking init/resume fails `Loop.make`; `handle` still dies before save. Docs: strict-rules.md (rule 4: command completion), decider.md, program.md, loop.md.
2. **anyOrder finals.** `Story.Outcome = { finals: NonEmptyReadonlyArray<{ order, model, final }>, cases }`; `Reached.order` becomes the step-number list. `StoryRecord.Final = Struct({ order: Array(Int), final: String })`; `Tale.Reached.finals` beside a decision's `final`, which stays. Record `finals` (version 3 stays: unreleased); regenerate `test/fixtures/report.json`. Tests (`test/Story.test.ts`): the review's increment/reset probe gives two finals with their orders; a nested anyOrder flattens its order; a story without anyOrder gives one final with `order: []`. Docs: stories.md, story-record.md, tales-and-covers.md.
3. **Exploration properties.** `Exploration.Update<Model, Message, Command>` and `Exploration.Ruling<State, Command, Event, Rejection>`; `properties` in both options. Program properties run in `machine` after `settle` (stories pass none); Decider properties run in `strict`'s `rule` after the transition (decisions pass none). Problem `property <name> does not hold` with before/input/after in `actual`; a throw is `property <name> threw: …`. Tests (`test/Exploration.test.ts`): a wrong-arithmetic Program and Decider each fail with a shrunk counterexample and a replay token that reproduces it; a passing property passes; a throwing property fails at its step. Docs: explorations.md with a checked snippet.
4. **`effect-storytime/vitest`.** Move `src/testing/Vitest.ts` to `src/vitest/Vitest.ts` with `src/vitest/index.ts`; `package.json` exports `./vitest`; tsconfig `paths`; an oxlint override bans `vitest`, `@effect/vitest`, `node:*` and `**/vitest/**` in `src/testing/**`. Update every import in tests, examples and docs. Check: lint, build (`dist/vitest/index.js`), and by hand `node -e "import('./dist/testing/index.js')"` with a loader hook that logs no `vitest` or `node:fs` module. Docs: vitest.md, docs/README.md, README Install/quick start, AGENTS.md (three entries), ADR 0003 note.
5. **`Loop.join`** on the Loop interface over `FiberMap.join`. Tests: a dying handler makes `join` die with its defect while `dispatch` succeeds; a reply breaking an invariant makes `join` die with `InvariantBroken`; closing the scope makes `join` succeed. Docs: loop.md.
6. **Shrinkable callbacks.** `replies`/`emits` through `attempt` in the Program walker. Tests: each throwing callback fails with a counterexample and replay token.
7. **Effect-first cleanup.** `Effect.fnUntraced` for `transition`, `decideIn`, machine helpers and Loop's `sender`/`run`; `Effect.fn('Decider.handle')` around `handle`'s transaction, tested by a span assertion if cheap, else by tracer test with `Effect.withTracer`. AGENTS.md: a Principles section with the scope principle (keep what has a real use case) and Effect-first with pure domain callbacks.
8. **Gate, review, land, release.** `pnpm check`; a Codex review of the final commit; land on main; bump to 0.4.0, release commit and tag `v0.4.0`; README Install names it.

## Evidence

Non-UI change, so no screenshots: key files with one-line roles, 1–3 excerpts from the landed commit, the gate summary (tests, coverage, mutation score), the regenerated report fixture's `finals`, and the hand checks' output (testing entry loads no Vitest/fs; a Loop rejecting a breaking message).

## Open questions

None; the ADR settles the shapes.

## Settled findings

Codex review (GPT-6.1 Sol) of c38cea2, one finding:

- **Fixed**: `Vitest.tell(ctx, story, Story.run(story))` recorded each final's `model` too, since an `Outcome` structurally satisfies `Reached`; a model JSON can't hold (a `bigint`) broke the reporter. `told` now encodes the record through its schema (`Schema.encodeSync`, which keeps only the record's fields), which also replaces the hand-picked failure fields. Test: `test/vitest.test.ts` records only the record fields of a story run it is given.
