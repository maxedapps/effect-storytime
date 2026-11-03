# 0001 Effect-native story library

Status: Accepted

## Context

Infinite wants every rule with side effects tested as a story: a pure `update` or `decide`, side effects as data, and a strict test that accounts for every effect (task 2294, its Parts library-plan, library-design, testing-details and story-appeal). Max decided (#29008, #29009) that it becomes its own private library, `maxedapps/effect-storytime`, built for Effect 4 and embracing it, and that infinite then moves as many tests as possible onto it with no loss. Stories must also show up in reports as readable, deterministic data (#29011).

The 2294 design assumed a helper inside infinite: synchronous, throwing stories, gated by infinite's own mutation check. A standalone Effect library changes three things: it needs its own quality gates, it should run through Effect rather than around it, and infinite has to consume a versioned build.

## Decision

1. **Six modules, Effect-style namespaces**, each also its own subpath (`effect-storytime/Story`), as Effect does:
   - `Program`: `{ Model, Message, Command, update, resume, invariants }`. The three are Schemas; `update(model, message)` returns plain `{ model, commands?, cancels? }`.
   - `Loop`: runs a Program in a `Scope`: model in a `SubscriptionRef`, one fiber applying queued messages in order, commands in a `FiberMap` keyed by their canonical JSON, one handler (the Command union's `match`) returning an `Effect` or a `Stream` of messages, optional `persist` (save after each update, before its commands run; on start load and `resume`).
   - `Decider`: `{ State, Input, Event, Rejection, initial, decide, evolve, invariants }`, `decide` returning a `Result`. `Decider.Store` is the interface a `Context.Service` implements; `Decider.handle(decider, Store)` loads, decides and saves in the store's transaction.
   - `Story` and `Decision` (two modules): stories are values (title, program or decider, steps as tagged data). `Story.run` and `Decision.run` return `Effect<Outcome, StoryFailure>`; `Story.explore` builds a generated story checked with `effect/Arbitrary` (`checkEffect`: seeded, shrinking, replay token); `Decision.against` replays a decision through `handle` on a real Store layer; `Story.covers` checks every Message, Command and Model case is reached.
   - `StoryRecord`: the Schema of the report record. `Story.lines` and `Decision.lines` render any tale as plain given/send/commands lines from its value alone.
2. **Strict by construction**, inside every run: exact command sets (by canonical JSON), every produced command asserted before anything drops it and none owed at the end, `resolve` and `emit` only of pending commands, the model round-trips through its Schema after every step, `update` and `decide` run twice, leave their input's JSON unchanged and must agree, invariants after every step, given values and produced values must satisfy their Schemas. Generated paths skip only the command assertions.
3. **Vitest is optional**: `effect-storytime/vitest` registers stories as `@effect/vitest` tests (`stories(...)`, `covers(...)`) and attaches each record to the test's `meta`; `effect-storytime/reporter` is a Vitest reporter that writes them, sorted, to one JSON file (`version: 1`). Without the adapter, any `it.effect` can run `Story.run`.
4. **Gates in `pnpm check`**: oxfmt, oxlint (type-aware, Effect presets, vendored anti-slop), `tsc` (TypeScript 7) with the Effect language service, Vitest with 100% v8 coverage of `src`, Stryker with a break threshold of 100 (equivalent mutants disabled inline with a reason), and the build.
5. **Consumption**: `effect` (and optionally `vitest`, `@effect/vitest`) are peers. The repository is public and releases are published to npm as `effect-storytime` by a GitHub Actions workflow on a `vX.Y.Z` tag, with provenance; infinite pins the exact version. (Amended 2026-11-03, when Max made the repository public: 0.1.0 was a git tag whose commit carried the built `dist/`.)

## Alternatives

- **Synchronous throwing stories (the 2294 design).** Simplest, runner-agnostic. Rejected: Max asked for Effect-returning runners, and typed `StoryFailure`s compose with `Decision.against`, `explore` and `covers`, which are Effects anyway.
- **Commands with attached `execute` (Foldkit).** Rejected: effects in the domain, and tests would see them.
- **infinite's in-house mutation check, or none.** A copy of ADR 0504's 336 lines would be a second thing to maintain; Stryker's Vitest runner gives the same "no survivor" rule with a break threshold of 100.
- **Consumption by a registry** (GitHub Packages) needs a `read:packages` token on every machine; **a vendored tarball** in infinite needs a copy per release; **a git dependency on source** fails because Node won't strip types under `node_modules`. While the repository was private, tags carrying `dist/` needed nothing but the Git access agents already had; once public, npm needs no access at all and gives consumers provenance.
- **Event-sourced Decider storage.** Left to the app: `Store.save` gets the events and may keep them.

## Consequences

- Infinite needs `effect` 4.1 (planned in 2284) before it consumes 0.1.
- Story syntax names message and command tags; renames touch stories.
- A command identical to a running one replaces it, in the Loop and in stories alike (commands are a set).
- Stories check rules, not wiring, real atomicity or fiber races; those stay with harness, database and stage tests.
- The record format is versioned; a breaking change bumps `version`.
