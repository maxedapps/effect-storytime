# 0006 Plan: a Loop that runs a process to the end

Task 3311. ADR: [0006](0006-a-loop-that-runs-a-process-to-the-end.md).

## Goal

The Loop runs a Program's commands through the app's handlers (typed errors), commits the model and the transition's writes in one store transaction, feeds replies back, and waits until the Program settles, so infinite's three drivers (Teachable grants, the Conversation, the Video DO) move onto it.

Non-goals: concurrent Loops on one stored model, changes to `Program` or the tales, an infinite migration (its own task).

## Tasks

1. `src/Loop.ts`: `E` on `Handler`, `Options`, `Loop`; `Write` and `write`; `Store` replaces `Persist`; start and transitions in `store.transaction`; `settled`; `run` (span `Loop.run`). Verified by `test/Loop.test.ts`: typed failures reach `join`/`settled`/`run`, writes run in order inside the transaction before work starts and roll back with an invariant break, a store failure fails make/dispatch and keeps the model, `settled` waits for replies and fails early, `run` interrupts on failure.
2. Example `test/examples/enrolment.ts`, modelled on Teachable mirroring (find the user, read the enrolment, decide), with stories and an exploration in `test/docs/enrolment.test.ts`; its `run` with a typed directory failure is the docs snippet.
3. Docs: `docs/loop.md` (handlers, writes, store, settled, run, a driver's migration), README's Loop lines, `docs/recipes.md` (awarding with `store`), `docs/pitfalls.md`, `docs/README.md` (ADR 0006); snippets in `test/docs/loop.test.ts` and `test/docs/awarding.test.ts`. The story record is unchanged, so no `StoryReport` bump.
4. Gate `pnpm check`; land; release 0.5.0 (breaking).

Hand check: none visual; the docs snippets run as tests.

## Evidence

Key files and 1–3 excerpts from the landed commit; the migration guide for a hand-written driver in the report.

## Settled findings
Codex review of b5b477e:

- **Fixed (high):** `settled` could succeed between a reply cancelling its own command and the start of the command it led to, because `enact` removed cancels before it ran the new work and `FiberMap.awaitEmpty` saw an empty map. `enact` now starts the new commands first and then removes the cancelled keys it didn't just start. Regression: 'waits for the command a reply starts as it cancels its own'.
- **Fixed (medium):** `run` dispatched all `messages` before it looked at command failures, so writes could commit after a terminal failure. `run` now races `join` against dispatching and settling. Regression: 'dispatches no message after a command failed'.
- Lead's own, before review: removed `settled`'s re-check of `FiberMap.deferred`. A failing fiber completes the deferred in the same observer that removes it from the map, so `join` always wins; 300 stress runs confirmed it. `Write` became a class checked with `instanceof`, replacing a string type id that Stryker showed no test could tell apart.
