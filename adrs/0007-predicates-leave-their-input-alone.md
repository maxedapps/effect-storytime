# 0007 Predicates leave their input alone, and identical commands are one

Status: Accepted

## Context

Task 3316 (task 3316's domain analysis, approved in #46582):

- **Predicates see live values.** Stories hand `satisfies` and the invariants the model a story keeps, explorations hand properties the settled model, and `Decision.run` hands `satisfies` the state it keeps. A predicate that assigns a field rewrites the tale's own value, so a later `model(...)` passes on a value `update` never gave. In production, `Loop` and `Decider.handle` share `internal/invariants.ts`, which hands each invariant the model or state about to be saved, so a mutating invariant changes what is saved.
- **Identical commands.** A story keeps pending commands by canonical JSON, so two identical commands in one `update` are one pending command. The 0.5.0 Loop runs every listed command: an identical work command starts twice (the second replaces the first), and an identical write runs twice.

## Decision

1. **Detect, don't copy.** Every predicate a tale runs (invariants, properties, `satisfies`) must leave the canonical JSON of its input unchanged; a change, leaving the input unencodable included, fails the step with `<predicate> changed its input`, the same rule and message `update`, `resume`, `decide` and `evolve` already follow. In production, `enforce` compares the value's canonical JSON (or why it is not JSON) before and after each invariant and dies with the defect `Program.InvariantChanged { invariant, before, after }` before anything is saved, as a broken invariant dies with `InvariantBroken`.
2. **Identical commands are one** in the Loop too: `commit` keeps the first of identical commands in one `Next`, so an identical write runs once and an identical work command starts once.

## Alternatives

- **Hand predicates a copy** (the simplest option for tales): the tale passes, while production, which hands the invariant the live value, still suffers the mutation. A copy in production costs a decode per transition and hides the bug instead of naming it.
- **Check only in tales**: tales prove the predicates they reach pure; a mutation on a path no tale reaches still changes what production saves.
- **Let a Story show duplicates**: identity is canonical JSON everywhere else (`resolve`, `emit`, cancels, the Loop's fiber keys), so a pending list with two identical entries could never be resolved one at a time.

## Consequences

- Non-breaking (0.5.1): a new defect class; a Program with invariants pays two canonical encodings per invariant per transition.
- A Program that listed one write twice to run it twice must now list two different commands, which its tales already required.
