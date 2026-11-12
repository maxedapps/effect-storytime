# 0006 A Loop that runs a process to the end: typed handlers, writes, a transactional store, `settled` and `run`

Status: Accepted

## Context

Task 3311: infinite runs its Programs on hand-written drivers, because the 0.4 Loop does not fit them (DDD review `infinite-3311-ddd-review`; Max chose to close the gap in effect-storytime, #46485):

- **Teachable mirroring** (`teachable/grants.ts`, `stepped`): runs `update`, runs the one command through a handler that fails with `TeachableFailed`, feeds the reply back, until the model is `Decided`; returns that model or fails with the typed error. The Loop's handler has the error type `never`, and nothing waits until a Program settles.
- **The tutor Conversation** (`tutor/conversation/Conversation.ts`, `flow`): per request or alarm, it loads the stored phase, applies one message, then per transition, in one storage transaction, saves the phase and runs the transition's *writes* (log events, alarms, check-ins) in order; then forks the *work* commands, feeds their replies back, and returns once nothing runs, or fails with `Busy`, `Superseded` or `LimitReached`. `persist.save` sees no commands, so writes can't commit with the model.
- **The tutor Video DO** is to become a Program with the same shape (claim, write, narrate as work; phase, log events and alarms as writes).

## Decision

1. **Typed handler errors.** `Handler<Message, Command, E, R>` returns `Effect<Message | void, E, R>`, `Stream<Message, E, R>` or a `Loop.Write<E, R>`. A failure that the Program should decide on is still mapped to a message by the handler; any other failure fails the command fiber, so `join`, `settled` and `run` fail with it. The Loop keeps applying messages, as it did for a defect.
2. **Writes.** `Loop.write(effect)` marks a command whose effect belongs to its transition: it runs during the apply, in the order `update` listed it, inside the store's transaction with the model's save, before the model is published or any work starts. The handler stays one exhaustive `match` over the Command union; the Program is unchanged.
3. **A transactional store** replaces `persist`: `store: { load, save, transaction }`, shaped like `Decider.Store`, every effect with the error type `E`. The start (load, `resume` or `init`, invariants, save, writes) and every later transition (invariants, save, writes) each run in one `transaction`. A failure there fails that transition, which changes nothing: `make`, the `dispatch` or the command whose message it was fails with it.
4. **`loop.settled`** waits until no command runs and gives the model; it fails as soon as a command fails. **`Loop.run(program, { ...options, messages })`** starts a Loop in its own scope, dispatches `messages` in order and returns `settled`'s model, in the span `Loop.run`; its scope closes on success or failure, so a failure interrupts the commands still running.

## Alternatives

- **Keep `never` and teach drivers to wrap** (the simplest option): every driver keeps its own failure channel beside the Loop: what the review found.
- **`save(model, commands)`**, as `Decider.Store.save` gets the events: the store writes what belongs to its transaction, but the handler still runs every command, so each write needs a no-op handler and the ordering contract lives in two places.
- **Two handler options (`writes` and `handler`)**: splits one exhaustive match into two partial ones whose union TypeScript can't check for completeness.
- **Reload the model from the store in every transition** (the Decider discipline, safe for concurrent Loops on one key): the Conversation stores a lossy projection, and a second Loop's `resume` would clobber a running one. One Loop per stored process at a time; the app serialises (a Durable Object, a lock).
- **A `settled` that also returns which command failed**: the typed error already says it.

## Consequences

- Breaking (0.5.0): `persist` → `store` with `transaction`; `Handler`, `Options` and `Loop` gain `E`; `dispatch`, `join` and `make` carry `E`.
- A hand-written driver becomes a handler (`match` with `Loop.write` for writes), a store and one `Loop.run` or a long-lived `Loop.make`.
- A load happens once, at the start; two Loops on one stored model diverge.
