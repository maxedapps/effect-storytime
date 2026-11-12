# 0008 Typed results per command

Status: Accepted

## Context

Task 3316 (analysis `effect-storytime-3316-alchemy-domain-analysis`, recommendation 2, approved in #46582). `decide(state, command)` was one function, so `Decider.handle`'s error was every rejection of the Decider. A caller that sends one command must still handle the rejections only other commands give. infinite narrows them by hand and dies on the rest (`decideSeatPool(key, command, ['OfferNotFound'])`, `decideListing`), so a new rejection on a command becomes a 500, not a compile error.

## Decision

1. **`decide` is a record with one pure handler per command tag** (`Decider.Handlers`), the shape a `Command.match` already takes. Each handler gets the state and the command of its tag. Command, Event and Rejection stay whole-union Schemas: JSON, covers and generated commands don't change.
2. **Each handler's inferred return type is its command's contract.** `Decider` and `Definition` carry the handlers' own type as a fifth parameter, and `handle` gives `<C extends Command>(key, command: C) => Effect<Handled<State, EventOf<C>>, RejectionOf<C> | E, Id>`. A command typed as the whole union gives every handler's events and rejections.
3. **Replace the function form** (0.6.0, breaking), with no parallel path. Step builders, tales and explorations dispatch through one internal `decideBy`.

`handle` keeps one asserted return type (with a `SAFETY` comment): TypeScript can't relate a command to its tag's handler across the generic. The dispatch itself needs no assertion.

## Alternatives

- **Keep the function and let callers narrow** (the simplest option): what infinite does today; every new rejection is a runtime surprise.
- **A per-command contract declared beside the Schemas** (`{ Withdraw: { events: [...], rejections: [...] } }`): a second source of truth the handlers must agree with; the inferred return type already is that contract.
- **Overloads per command**: TypeScript can't generate them from a mapped type.

## Consequences

- Breaking for every Decider: wrap each `Command.match` case in `(state, command) =>` and pass the record. Callers' hand-written narrowing goes away, and a `flow(Decider.handle(...), ...)` wrapper keeps the per-command types.
- A stray event or rejection, a missing handler or a wrong field is reported on the handler's own line. A wrong field names the command as `{ _tag: 'X', ... } & { _tag: 'X' }`.
- In infinite's apps/api the migration type-checks as fast as before, with about 10 % fewer type instantiations.
