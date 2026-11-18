# 0009 Invariants that break, and fresh exploration seeds

Status: Proposed

## Context

Task 4013 (research `research-4013-story-testing-review`, §2 and §6, approved by Max). Two gaps in the testing entry:

- **Vacuous invariants.** Tales check every invariant at every step, but an invariant that can never be false passes them all silently. infinite proves 8 of 22 subjects' invariants can fail with hand-written `it.each(invariants)` tables and the rest not at all.
- **Explorations never vary.** Each exploration's seed defaults to its title, so every run checks the same paths. Nothing lets a nightly run try fresh seeds or more runs without changing test code.

## Decision

1. **`Tale.breaks(subject, states)`** takes, for each invariant of a Program or a Decider, a model or state that breaks it, and fails with `Unbroken` unless each is valid, survives JSON and breaks exactly its invariant, no other. `Vitest.breaks` registers it as one test, as `Vitest.covers` does for `Tale.covers`. Exactly one: a state that also breaks another invariant proves less, and an invariant that only ever breaks together with another adds nothing.
2. **Invariant names are part of the type.** `Program` and `Decider` get a last type parameter `Name extends string = string`, inferred by `make` from the invariants (`never` without any), so `breaks`' `states` must name every invariant and nothing else. A subject typed without it (`Decider<S, C, E, R>`) takes any names; `breaks` still checks every invariant at runtime and fails with `no state given` for a missing one.
3. **`STORYTIME_SEED` and `STORYTIME_RUNS` override every exploration when it is checked**, read through Effect `Config` (the environment by default, any `ConfigProvider` in tests). `STORYTIME_SEED` is `random`, a fresh seed per check from Effect's `Random`, or an integer; `STORYTIME_RUNS` a positive integer. They override the exploration's own `seed` and `runs`; an invalid value dies. The failure's `line`, now also printed in its message, names the seed and runs that ran, so `STORYTIME_SEED=<printed seed>` reruns the failing check and the `replay` token still replays its one path.
4. The tale's own `lines` (and so the story record) keep the exploration as written; only a failure's `line` shows the overrides. The record stays byte-stable across seeds.

## Alternatives

- **No helper, document the `it.each` table** (the simplest option): every app hand-writes it, and nothing requires one row per invariant.
- **One test per invariant**: registers more tests for the same check; one test naming the failing invariant matches `covers`.
- **A runtime-only key check, no type parameter**: catches a missing invariant only when the test runs, and a renamed invariant silently leaves a stale row until then.
- **Seed and runs as options of `Vitest.stories`**: test code changes per run, and other runners and `covers` don't see it. `Config` is the Effect way to read the environment and stays runner-agnostic.
- **Exempting `covers` from the overrides**: keeps `covers` deterministic but needs a second way to run a tale. Under fresh seeds `covers` fails when a case is reached only by the title seed's paths, which is worth knowing: tell a story or decision for it.

## Consequences

- `Program` and `Decider` have one more type parameter. Code that names the full types keeps working; a subject annotated without it loses the compile-time check of `breaks`.
- `breaks` flags an invariant implied by another (breaking it always breaks the other too): drop or merge it.
- A nightly job can run `STORYTIME_SEED=random STORYTIME_RUNS=1000 vitest run` with no test changes; `covers` then runs its explorations with those settings too.
- An exploration failure's message gains its line.
