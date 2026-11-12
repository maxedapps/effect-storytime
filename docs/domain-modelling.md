# Domain modelling

effect-storytime keeps to the functional core of Domain-Driven Design. A domain is two kinds of pure state machine whose inputs, outputs and side effects are all Schema data:

- A **Decider** ([decider.md](decider.md)) holds the rules of one consistency boundary. `decide(state, command)` gives events or a rejection, `evolve(state, event)` folds an event into the state, and named invariants say which states may exist. `Decider.handle` runs it on a Store in one transaction, which makes it an aggregate.
- A **Program** ([program.md](program.md)) holds the state of a process or a screen. `update(model, message)` gives the next model, the commands to start and the commands to cancel. A **Loop** ([loop.md](loop.md)) runs it, and its commands are where effects happen.

Everything else is plain Effect. [ADR 0003](../adrs/0003-lean-domain-library.md) explains why there are no aggregate, repository, policy or event store types.

## Where each building block lives

| DDD building block | In effect-storytime |
| --- | --- |
| Aggregate | A Decider plus a Store whose transaction protects what it read. There is no aggregate class. |
| Command, event, rejection | `Schema.TaggedUnion`s. `handle` turns a rejection into the Effect's typed error. |
| Invariant | A Decider's or Program's named predicates, checked by every tale and by `handle` before it saves. |
| Repository | A `Decider.Store` your app implements as a `Context.Service`, on one row or several tables. |
| Process manager | A Program. Its model remembers what is under way, and its commands drive Deciders. |
| Value object | A Schema with `Schema.brand` and checks, plus plain functions. |
| Port, adapter | A `Context.Service` and its `Layer`. |
| Projection, query | A SQL query in an `Effect.fn`. In memory, `events.reduce(decider.evolve, decider.initial)`. |
| Policy | A pure function from an event to commands. |
| Saga, durable workflow | `effect/workflow`, used directly. |
| Agent tool | An `effect/ai` `Tool` with the command's Schemas, calling `handle`. |
| Bounded context | A package or a folder, kept apart by import rules. |

## Choosing a Decider or a Program

Use a **Decider** when concurrent requests change the same state and a rule must hold across them: a membership granted once, a seat sold once, a badge earned once. The Store's transaction is what makes the rule hold, so the Decider's state is exactly what one transaction loads.

Use a **Program** when something runs over time and talks to the outside: a chat waiting for a streamed answer, a form waiting for a request, a process waiting for Deciders. Its commands are requests for effects (an HTTP call, a `Decider.handle`, a save), and their results come back as messages.

A Program never changes a Decider's state directly. It asks with a command, and the Loop's handler calls `Decider.handle` ([recipes.md](recipes.md) shows the whole pattern).

## Rules for the Schemas

- `Command`, `Event` and `Rejection` of a Decider, and `Message` and `Command` of a Program, should be `Schema.TaggedUnion`s. A Program requires them to be: its `Message` and `Command` must list their `cases`, which `Schema.TaggedUnion` does and `Schema.TaggedStruct` alone does not. A single-case union is fine (`Schema.TaggedUnion({ Award: { ... } })`).
- A Program's `Model` and a Decider's `State` may be any Schema. When one is a tagged union, its cases count towards coverage (`Model.Ready`, `State.Active`). A struct has no cases.
- Use the union's own tools: `Command.cases.Grant.make({...})` to build a value, `Command.match(value, {...})` or `Command.match({...})` for exhaustive handling, and `Command.guards.Grant(value)` to test one case. Don't compare `_tag` by hand or write `{ _tag: 'Grant', ... }` literals.
- Every value must survive a JSON round trip through its Schema unchanged, because tales copy every value that way and a Store or `persist` usually does too. Prefer encodable types (`Schema.Int`, `Schema.NonEmptyString`, `Schema.BooleanFromBit`, ISO date strings) over class instances or functions.

## Rules for the functions

`decide`, `evolve`, `update` and `resume` are pure. They read only their arguments and return new values:

- No `Date.now()`, `Math.random()`, `crypto.randomUUID()` or reads of mutable module state. Put the time or id into the command or message (`Grant.make({ source, at })`).
- No mutation of the state, model, command or message they get. Spread instead: `{ ...state, active: true }`.
- No effects. `decide` decides from the state the transaction loaded and the command alone. When a decision needs outside data, the caller reads it first and puts it into the command, or a Program fetches it with a command and sends it on as a message.

Every tale runs each function twice and checks that it changed nothing ([strict-rules.md](strict-rules.md)), so a test catches a function that breaks them.

## State is the truth

There is no event store. `Decider.Store.save` gets the events alongside the new state and may keep them as a history or an outbox, but the state it saves is what the next `load` returns and what the next decision reads.

A process that must survive restarts keeps its unfinished work in its model, and its `resume` reissues it. The commands it reissues must then be idempotent at their Decider, by an id or a key in the command that the Decider rejects a second time. [recipes.md](recipes.md) builds this with badges.

The Loop cannot recover a message that never reached it. If a Decider commits and the process crashes before the message about it is dispatched, nothing remembers it. Where that gap matters, write the message in the same transaction as the commit (an outbox) and deliver it from there, or run the process with `effect/workflow`.
