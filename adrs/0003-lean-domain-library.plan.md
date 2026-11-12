# 0003 A lean domain library: plan

ADR: [0003-lean-domain-library.md](0003-lean-domain-library.md). Task 3243 (Max #45038), design artifact `infinite-3243-ddd-library-v2`.

## Goal

Release effect-storytime 0.3.0: the domain entry (`Decider`, `Program`, `Loop`) and the testing entry (`effect-storytime/testing`), with `handle` giving `{ events, state }` after commit, runtime invariants through the shared transition, `against` verifying `given`, `Input` renamed to `Command`, the Store contract and a README "Domain modelling" chapter. All under the gate (100% coverage and mutation score).

## Non-goals

- New building blocks (Aggregate, Policy, Saga, Projection, Repository, event store, effectful `decide`).
- npm publishing (waits for `NPM_TOKEN`) and any change to infinite.

## Tasks

1. **Layout and entries**: domain in `src/` (`Decider`, `Program`, `Loop`, `index`) and `src/internal/` (`canonical`, `transition`); testing in `src/testing/` (`index`, `Story`, `Decision`, `Exploration`, `Tale`, `StoryRecord`, `Vitest` with the reporter) and `src/testing/internal/`. `package.json` exports `.` and `./testing`; a `no-restricted-imports` override keeps the domain off `testing/`. Verified by lint, tsc and the build (`dist/index.js`, `dist/testing/index.js`).
2. **`Command` rename** across Decider, Decision, Exploration, Tale cases, the record (version 2) and tests. Verified by the existing tests, renamed.
3. **Shared transition and `handle`**: `internal/transition.ts`; `handle` returns `{ events, state }`, dies with `InvariantBroken` before save. Tests in `test/Decider.test.ts`: the reached state and events after commit; a rejection; no events leaves the loaded state and saves nothing; a broken invariant dies and saves nothing.
4. **`against` verifies `given`**: tests in `test/Decision.test.ts`: arranged rows pass; a mismatch fails at step 1 with expected/actual; nothing is saved for `given`.
5. **Docs**: README (entries, Install v0.3.0, Domain modelling with a relational Store and a Program process manager, Store contract, Command), AGENTS.md (entries, layout), this ADR and plan; reporter fixture regenerated.
6. **Review and gate**: other-harness review of the full diff; `pnpm check` green.
7. **Release**: version commit 0.3.0 on `main`, release commit with `dist/` outside `main`, tag `v0.3.0` pushed.

## Evidence

No UI. The report carries the gate summary, the API summary of both entries, breaking changes against 0.2.0, and key excerpts (`handle`, the transition, `against`'s `given`).

## Open questions

None.

## Settled findings

- medium bug: the README's effect/sql Store meets the isolation and after-commit promises only as the outermost transaction; nested in another `withTransaction` it becomes a savepoint that ignores `BeginTransaction`, commits with the outer one and can't retry alone (reproduced by the reviewer: handle returned, then ROLLBACK) — fixed: the Store contract (Decider.ts, README) now requires `transaction` to be the outermost one and says not to call `handle` inside another transaction.
- medium bug: README claimed the awarding process manager doesn't survive a crash between a commit and the next command, but Loop saves the model before starting commands and `resume` reissues pending awards (src/Loop.ts) — fixed: README now names the real gap, an upstream commit whose message never reached the Loop, closed by an outbox or effect/workflow.
