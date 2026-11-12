# 0003 A lean domain library: Decider as the command side, testing as its own entry

Status: Accepted

## Context

Infinite runs its database rules on Deciders and its UI and workflow state on Programs (task 3243). Asked whether effect-storytime should become a Domain-Driven Design library for Effect 4, a Claude lead and a Codex partner agreed (artifact `infinite-3243-ddd-library-v2`): sharpen the kernel the library already has instead of adding a framework. Max decided the open points (#45038). Today's gaps:

- `Decider.handle` drops the state it reached, and runs the raw `decide`/`evolve`, while only tales check invariants. Runtime and tests can drift.
- `Decision.against` seeds `given` through `save(key, state, [])`. A Store that writes only from events (infinite's) ignores it, and nothing checks that the stored state is `given`.
- The docs say a Decider rules "one stored row"; infinite's rules a five-table decision model. `Store.transaction` has no documented isolation duty.
- Domain and testing modules share one entry, so production code imports a testing library.

## Decision

1. **Decider is the command side, Program the process manager.** An aggregate is a Decider plus a Store whose transaction protects everything `decide` read: a consistency boundary, not a class or a row. No Aggregate, Policy, Saga, Projection or Repository types, no event store and no effectful `decide`. Value objects (Schema brands and checks), ports (`Context.Service` + `Layer`), sagas (effect/workflow) and agent tools (effect/ai) stay plain Effect. Alchemy's `@alchemy.run/domain` is a reference only.
2. **`Input` becomes `Command`** on the Decider, its decisions, explorations and cases (`Command.X`). The story record's `version` becomes 2.
3. **One transition for runtime and tales.** `internal/transition.ts` decides, folds the events into every state they pass through and checks the invariants on the state reached. `handle` runs it with the plain callbacks; tales run it with the strict ones (validity, purity, JSON copies). A broken invariant in `handle` dies with `Decider.InvariantBroken` inside the transaction, so nothing is saved.
4. **`handle` resolves after the commit with `{ events, state }`**, the state the events reached (the loaded state when there are none).
5. **`Decision.against` no longer seeds.** The test arranges the Store; `given` loads the state under the key and fails unless it equals `given`.
6. **Store contract**: `transaction` must protect every row `load` read until `save` commits (SERIALIZABLE with retries, or guarded writes), and `load` must give back what `save` stored.
7. **One package, two entries.** The root exports the domain (`Decider`, `Program`, `Loop`); `effect-storytime/testing` exports `Story`, `Decision`, `Exploration`, `Tale`, `StoryRecord` and `Vitest` (adapter and reporter). The domain lives in `src/` and `src/internal/` and imports nothing from `src/testing/`, which a lint rule enforces. `effect` is the only required peer; `vitest` and `@effect/vitest` are optional peers that only the testing entry loads. The per-module subpaths go.

## Alternatives

- **Change nothing but docs** (the simplest option): handle would keep dropping the reached state and skipping invariants, and `against` would keep testing a seed infinite's Store ignores.
- **Split into two packages** (`effect-decider` + `effect-storytime`): the testing side uses the domain's internals (transition, canonical JSON), so both would release in lockstep with twice the release work.
- **An Aggregate type or an event store**: renames what a Decider plus a transaction already is, or adds append, version and checkpoint semantics no consumer needs.
- **Keep `./vitest` and `./reporter` as separate subpaths**: a config file can import the testing entry (it loads `@effect/vitest` without calling it), so one testing entry is enough.

## Consequences

- 0.3.0 breaks every consumer import (`effect-storytime/testing`), `Input` names, `handle`'s result and `against`'s `given`. Infinite repins in its own task.
- A latent invariant bug now fails the request instead of writing a bad state. That is intended.
- The library can't detect a wrong consistency boundary or a Store without isolation; the README states the contract.
