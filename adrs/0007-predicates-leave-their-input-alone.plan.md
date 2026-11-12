# 0007 Plan: effect-storytime 0.5.1 safe improvements (task 3316)

## Goal

Land and release 0.5.1 with the non-breaking items Max approved (#46582): mutating predicates fail, Story and Loop agree on identical commands, Schema-class docs, an end-to-end and crash recipe, CI, and the outside-library reference removed from ADR 0003.

## Non-goals

Per-command `decide` (0.6.0, another lead), DDD sizing guidance, `keyOf`, command metadata, a Store-contract helper.

## Tasks

1. **Predicates leave their input alone** (ADR 0007, decision 1). `check.ts`: an `untouched(name, input, run)` helper the existing `pure` builds on; `holds` takes the value's Schema and runs every predicate through it; Story's and Decision's `satisfies` too. `internal/invariants.ts`: compare canonical JSON around each invariant, die with `Program.InvariantChanged`. Tests: a mutating invariant, property and `satisfies` fail their step in Story, Decision and Exploration; a mutating invariant kills a Loop transition and a `Decider.handle` before saving.
2. **Identical commands are one** (decision 2). `Loop.ts` `commit` dedupes by canonical key and carries it into `enact`. Test: an identical write listed twice runs once; an identical work command starts once.
3. **Schema-backed classes.** `docs/domain-modelling.md` rule and `docs/pitfalls.md` name `Schema.Union([...classes]).pipe(Schema.toTaggedUnion('_tag'))`; one checked snippet in `test/docs/classes.test.ts` (a Program on `Schema.TaggedClass` cases with a story).
4. **Recipe.** `docs/recipes.md`: an end-to-end `Loop.run` with the real handler and Decider, and a crash after the Decider committed: resume reissues, the Decider rejects the duplicate (`test/docs/awarding.test.ts`).
5. **CI.** `.github/workflows/check.yml`: `pnpm check` on push to `main` and on pull requests, set up like `publish.yml`.
6. **ADR 0003.** Remove the outside-library reference.
7. Docs for 1 and 2: `strict-rules.md`, `pitfalls.md`, `loop.md`, `decider.md`, `program.md`; README if it names the checks.

Verified by `pnpm check` (100 % coverage and mutation score); no UI.

## Evidence

Key files and excerpts from the landed commit; the release tag and SHA.

## Open questions

None.

## Settled findings

- medium bug: a predicate that leaves its input unencodable (a Date set to NaN) made the after-encoding throw, so a tale died instead of failing at its step and enforce died with SchemaError instead of InvariantChanged — fixed: `untouched` treats a failing after-encoding as a change (its reason as `actual`), `enforce` folds a non-JSON value into its reason line (shared `notJson` in canonical.ts); regressions in test/Story.test.ts and test/Loop.test.ts.
