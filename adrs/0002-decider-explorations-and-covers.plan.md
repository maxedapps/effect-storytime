# 0002 Decider explorations and covers: plan

ADR: [0002-decider-explorations-and-covers.md](0002-decider-explorations-and-covers.md). Task 2309 (infinite part, Max #29667).

## Goal

Add explorations and covers for Deciders, as Programs already have, under the library's own gate (100% coverage and mutation score). Then release 0.2.0 as a git tag carrying `dist/`, with no npm publish, for infinite to pin.

## Non-goals

- npm publishing: it waits for `NPM_TOKEN`.
- Event-sourced storage, or exploring through a real Store. An exploration runs in memory; `Decision.against` keeps covering Stores.
- Any change to Program explorations beyond sharing `check` with Deciders.

## Tasks

1. **Shared Decider rules** (`src/internal/decider.ts`): move `checks` and `strict` out of `Decision.ts`, and add `caser`. `strict.rule` now validates the input itself. `internal/store.ts` `decideIn` returns the ruling (what was decided and the state reached), and `Decider.handle` unwraps it. Verified by the existing Decision and Decider tests.
2. **Decision cases**: `Decision.run` and `against` record the cases touched by `given`, each `when` and the states reached, and `Outcome` gains `cases`. Verified by `test/Decision.test.ts` (in memory and on the Memberships store), `test/vitest.test.ts` (the record) and the reporter fixture.
3. **`Exploration.decisions`**: paths `{ start, inputs }` from `given` and `when`, defaulting to `initial` and `Arbitrary.schema(Input)`. Both constructors map their paths to walks, and `check` runs walks. `Broken` moves to `internal/check.ts`. `Reached.cases` becomes required, since every tale now reports cases. Tests in `test/Exploration.test.ts`:
   - the defaults reach every membership case;
   - given states and inputs are used;
   - a throwing `decide` shrinks to `given, when Grant, when Revoke` at step 3;
   - an invalid given state fails at step 1.
4. **Covers for Deciders**: `Tale.cases` and `Tale.covers` take a Program or a Decider, and `tales` is any tales; the Vitest `covers` follows. Tests in `test/Tale.test.ts`:
   - a Decider's cases, including States for a tagged-union State;
   - a decision plus an exploration cover membership;
   - the missing cases named for the door and for membership.
5. **Docs**: README (Exploration, Tale and covers, Vitest, record `cases`), this ADR and plan, and the AGENTS.md Release section (git-tag releases carrying `dist/`; publishing through a GitHub Release).
6. **Release**: the publish workflow moves to `release: published`. Bump `version` to 0.2.0 on `main` in its own commit. Then make the release commit with `dist/` (force-added) and without the `prepare` script, as v0.1.0 did, tag it `v0.2.0` and push the tag.
7. **Gate**: `pnpm check` in the worktree, rebased on `main`, then a fast-forward of `main`.

## Evidence

No UI. The person gets the gate summary (coverage and mutation score), the new API in the README, and a shrunk Decider counterexample from the tests.

## Open questions

None.

## Settled findings
