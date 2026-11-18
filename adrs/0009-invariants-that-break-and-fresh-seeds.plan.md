# 0009 Plan: invariants that break, fresh seeds, where tales stop (task 4013 part A)

## Goal

Three general improvements Max approved (task 4013, research §6 items 3–5): prove each invariant can fail, run explorations with fresh seeds and more runs on demand, and one docs pass on where tales stop, what `covers` proves and grouping tales by rule. Released as 0.7.0 (a type parameter added to `Program` and `Decider`, a new failure message line).

## Non-goals

Anything only infinite or agent reports need; the story record format and paste-ready counterexample code (part B, in parallel).

## Tasks

1. `Name` type parameter on `Program`/`Decider` (`src/Program.ts`, `src/Decider.ts`); `Tale.breaks`, `Tale.Unbroken`, `Tale.Judged`, `Tale.Breaking` (`src/testing/Tale.ts`); `Vitest.breaks` (`src/vitest/Vitest.ts`). Tests in `test/Tale.test.ts` and `test/vitest.test.ts`: passes for the examples, each failure message (no state, invalid, holds it, breaks another too, throws, mutates), type errors for a missing, extra or wrongly typed entry (`@ts-expect-error`).
2. `STORYTIME_SEED`/`STORYTIME_RUNS` through `Config` in `Exploration.check` (`src/testing/Exploration.ts`); the line in `StoryFailure.message` (`src/testing/Story.ts`). Tests in `test/Exploration.test.ts` with `ConfigProvider.fromEnv`: random seed via `Random.withSeed` printed and rerun by that seed, fixed seed, runs, invalid values die.
3. Docs: `docs/strict-rules.md` (where tales stop), `docs/tales-and-covers.md` (what `covers` proves; `breaks`), `docs/vitest.md` (`breaks`, one `describe` per rule), `docs/explorations.md` (fresh seeds and runs), `docs/program.md`/`docs/decider.md` (point at `breaks`), README quick start and docs map; snippets in `test/docs/` and `test/examples/seats.test.ts`.
4. `pnpm check`, review by Codex, land, release 0.7.0 (or the next minor after part B's release).

## Evidence

Key files and excerpts from the landed commit, the new failure messages as printed, the tag and SHAs.

## Open questions

None.
