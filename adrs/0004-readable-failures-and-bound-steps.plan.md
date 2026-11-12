# 0004 Plan: readable failures, bound step builders, Loop close (task 3293)

## Goal

A failing tale reads well in Vitest; tests build steps without type parameters; `Loop.dispatch` after close no longer hangs; AGENTS.md records how scope is judged. Non-goals: ci.yml, `Decision.against` as a tale, Store model runs, and the release, which follows a later change.

## Tasks

1. `StoryFailure`: `message` field → `problem`, a `message` getter rendering the failure; record version 3; regenerate `test/fixtures/report.json`. Tests: the message of a story, decision, `anyOrder`, end and exploration failure.
2. Call sites: `internal/tale.ts` keeps each tale's caller stack (WeakMap), set by the four constructors; every StoryFailure gets it as its stack. Test: a failure's stack names the test file and line of its `make`.
3. `Story.of(program)`, `Decision.of(decider)`; free builders removed; every test, example and doc migrated; `docs/pitfalls.md` loses the "`Story.steps` infers never" pitfall.
4. Loop: on scope close, end the delivery queue, drain what was dispatched, then interrupt commands; `dispatch` after close is interrupted. Test: dispatch after close completes as interrupted.
5. AGENTS.md: scope is judged by general use cases; infinite is a reference, not the measure. README.md:113 names a Store service, not the State Schema.
6. README and docs/ for all of it; `pnpm check`.

## Evidence

Before/after Vitest FAIL blocks of a failing story, decision and exploration (scratch test, not committed); key files and snippets.

## Open questions

None.

## Settled findings

- medium bug: with a parallel caller scope, the FiberMap closed while the deliveries were still draining, so a dispatch accepted before close was interrupted and its command never started — fixed: the Loop's FiberMap and delivery worker share a sequential child scope; the close test runs under both strategies and fails on the parallel one without the fix.
