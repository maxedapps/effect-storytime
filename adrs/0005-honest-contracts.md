# 0005 Honest contracts: one invariant boundary, every anyOrder outcome, a runner-free testing entry

Status: Accepted

## Context

Task 3293: a design review (artifact `effect-storytime-3293-design-review`) and an Effect audit (`effect-storytime-3293-effect-audit`) of 0.3.0 found contracts that say one thing and do another. Max chose what to fix (#46302, #46341):

- Stories reject a Program model that breaks an invariant, yet `Loop` saves, publishes and acts on it. docs/strict-rules.md promises Decider invariants on every state a command's events pass through; `transition` checks only the state reached.
- `anyOrder` runs the rest of a story once per order, but `run` and the record keep only the first order's final model, so orders that end differently pass unseen.
- Explorations check invariants and strict rules per step, but nothing about a transition itself (an accepted debit lowers the balance by exactly its amount).
- `effect-storytime/testing` loads Vitest, `@effect/vitest` and `node:fs` even to decode a report or run a story by hand.
- A crashed command fiber vanishes: dispatch and the scope succeed. A throwing `replies`/`emits` callback escapes an exploration as a defect, with no shrunk counterexample and no replay token.

Max's direction (#46341): effect-storytime is as Effect-first as possible across its whole API, while domain callbacks (`decide`, `evolve`, `update`, `resume`) stay pure.

## Decision

1. **One invariant boundary for both runtimes.** `Decider.handle` and `Loop` check invariants with one internal helper and die with the same defect, `Program.InvariantBroken` (it moves beside `Invariants` in Program.ts, which both subjects already share). Loop checks every model (start, resume, each update) before it saves, publishes or starts commands; the message that broke it fails its `dispatch` (or its command fiber), and the model, store and commands stay as they were. Decider invariants are checked once per command, on the state its events reach (command completion); the docs say exactly that.
2. **Every order's outcome.** The steps after an `anyOrder` already run in every order; now `Story.run` gives `finals`, one per order (`order` as the step numbers of the anyOrder units as they ran, flattened across anyOrders, the model and its line), and a story's record keeps them as `finals: [{ order, final }]` (`StoryRecord.Final`). A decision has no orders, so its record keeps its one `final` and `Decision.Outcome` stays `{ state, final, cases }`. `StoryReport` stays at version 3, which build A introduced and no release has shipped yet. A `model(...)` after the `anyOrder` is how a story asserts convergence.
3. **Exploration properties.** `Exploration.make` takes `properties: Exploration.Properties<Exploration.Update>` over `{ before, message, after, commands, cancels }` for every `update` a path runs (in `machine`, after `settle`); `Exploration.decisions` takes them over `Exploration.Ruling`, `{ before, command, decided, after }`, for every command (in `strict`'s `rule`). Stories and decisions pass none. They run after the strict rules of that step, inside the existing walk, so a failing or throwing property shrinks and gets a replay token like any rule; `actual` shows the step as canonical JSON.
4. **`effect-storytime/vitest`.** `Vitest` (adapter and `Reporter`) moves to its own entry, `src/vitest/`; the testing entry imports neither Vitest nor `node:*`, which a `no-restricted-imports` override enforces. This supersedes ADR 0003's single testing entry.
5. **Observable commands.** `Loop.join` waits on the Loop's command fibers (`FiberMap.join`): it succeeds once the Loop's scope closes and dies with the first command that dies. Exploration `replies`/`emits` run through `attempt`, so a throw is a Problem at its step.
6. **Effect-first internals.** Reusable generator helpers in touched code become `Effect.fnUntraced`; `Decider.handle`'s transaction runs in `Effect.fn('Decider.handle')`, a span at the runtime boundary.

## Alternatives

- **Docs only** (the simplest option): document that Loop skips invariants and that `final` is the first order's. Keeps two invariant contracts and a record that hides divergent orders.
- **Check Decider invariants on every intermediate state**: rejects valid event sequences whose middle states are transient (a transfer's debit before its credit). Command completion is the consistency boundary.
- **One `final` when all orders agree, several otherwise**: two record shapes for one field; a reader has to branch.
- **`finals` for decisions too, with `order: []`**: one field for both kinds, but `Decision.Outcome` would carry a list it never needs, or `Vitest.tell` would silently drop a `Decision.against` run's final.
- **Loop keeps its own `InvariantBroken`, or both namespaces re-export one**: two names for one defect.
- **Properties on stories too**: a story already asserts each step with `model`/`satisfies`; properties pay off on generated paths only.
- **Run every order to completion with `Effect.exit` and report all failures**: the first failing order already pins the bug; more output, no more signal.

## Consequences

- Breaking (0.4.0): `Decider.InvariantBroken` → `Program.InvariantBroken`; `Story.Outcome` has `finals` instead of `model`/`final`; a story's record has `finals` instead of `final` (version 3, unreleased); `Vitest` imports from `effect-storytime/vitest`; Loop rejects invalid models it used to accept.
- A Loop pays one invariant pass per update; invariants are cheap predicates by contract.
