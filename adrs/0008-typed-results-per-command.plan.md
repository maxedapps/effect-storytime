# 0008 Plan: typed results per command (task 3316, 0.6.0)

## Goal

`decide` keyed by command tag and `handle` typed per command (ADR 0008), released as 0.6.0 if Max's gate (#46582) holds: infinite's seatPool Decider type-checks in the new shape with its hand-written narrowing gone, and tsc time and wrong-handler messages stay acceptable.

## Non-goals

Changing infinite itself (its orchestrator migrates after the release), per-command Schemas, a parallel function form.

## Tasks

1. `src/Decider.ts`: `Handlers`, `EventOf`, `RejectionOf`, the fifth type parameter, the typed `handle`. `src/internal/transition.ts`: `decideBy`. Testing entry: dispatch through `decideBy`, `Command extends Tagged`. Test: `test/Decider.test.ts` types each command by its handler (`expectTypeOf`) and runs it.
2. Examples and tests on the record form; README.md, `docs/decider.md`, `docs/domain-modelling.md` and the handle snippet show per-command typing.
3. Gate, in a scratch clone of infinite (`~/tmp`), never in its checkout: tsc on apps/api with 0.5.0 + its code vs this branch + the migrated Deciders (seatPool, learnerCourse, attempt, siteAction, badge) and call sites (`decideSeatPool` tag lists, `decideListing`); wrong-handler messages before and after.
4. `pnpm check` (100 % coverage and mutation score), rebase on 0.5.1, land, release 0.6.0.

## Evidence

The measured gate, the migration diff as a per-file guide, key files and excerpts, the tag and SHA.

## Open questions

None.

## Settled findings

- medium bug: `EventOf` gave `unknown` for a handler that only rejects (`Result.fail` succeeds with `never`, and `ReadonlyArray<infer Event>` inferred from `never` is `unknown`) — fixed: infer the success array first (`infer Events extends ReadonlyArray<unknown>`), then `Events[number]`; `test/Decider.test.ts` types a rejection-only Revoke, and fails on the old `EventOf`.
