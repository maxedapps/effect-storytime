# Plan: steps as data, a Markdown page, paste-ready counterexamples (task 4013 B)

## Goal

Readable story output for every user: steps and finals recorded as data (record v4) with a built-in Markdown renderer, and a failing exploration's shrunk path printed as `Story.make`/`Decision.make` code that runs as a tale once pasted. ADR 0010 holds the design.

Non-goals: seed and run selection and the failure's seed line (part A, ADR 0009); `StoryRecord.diff`.

## Tasks

1. `src/testing/internal/steps.ts`: `Value` and `Step` Schemas, `say(...)`, `line(step)`; Story and Decision steps say their verb and values once, for data, lines and code. Tests: lines unchanged for every existing tale (existing suites), notJson values.
2. Story, Decision, Exploration, Tale: `Told.steps` instead of `lines`; `Tale.steps`; `Reached.final(s)` and the outcomes' `final` as values (the Vitest adapter records outcomes).
3. Explorations: Program paths assert produced commands, Decider paths their outcome before properties; `StoryFailure.counterexample` as steps, `code` from `internal/code.ts`, decoding canonical JSON through the subject's Schemas. Tests: the pasted code, as source and as a tale that fails at the same step; a branded `Schema.Class` model (tsc and a run); values that round-trip (Option, bigint, NaN, undefined, non-identifier keys).
4. StoryRecord v4 and `markdown(report)`; reporter writes steps. Regenerate `test/fixtures/report.json`; a Markdown fixture of the same run, `test/fixtures/report.md`.
5. Docs: story-record.md, explorations.md, stories.md (failures), tales-and-covers.md, vitest.md if it names lines, README; snippets from `test/docs/record.test.ts`.
6. Gate: `pnpm check`. Release 0.8.0 (part A released 0.7.0).

## Evidence

Key files and excerpts, a rendered page of the fixture report (`report.md`) and a failing exploration's message with its code.

## Open questions

None.

## Settled findings

- high bug: pasted code doesn't reproduce property failures; a Decider path's property failed before its outcome step, so the pasted decision was invalid — fixed: Decider paths name the outcome before checking properties (`strict(...).holds`); tales have no properties by design, so docs and ADR say to assert what the property checks at the failing step.
- medium bug: the runtime printer loses Schema construction (a branded field fails tsc, a `Schema.Class` becomes a plain object) — fixed: code decodes each value's canonical JSON through its role's subject Schema; the runtime printer, `Named` and raw values are gone. Test: a branded Class model, typechecked and run.
