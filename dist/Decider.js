/**
 * A Decider is the command side of a consistency boundary: `decide` holds one handler per command
 * tag that turns a state and that command into events or a rejection, `evolve` folds an event into
 * the state, and named invariants say which states may exist. `handle` runs it on a Store in one
 * transaction, which makes it an aggregate, typed per command by its handler.
 */
import { Effect } from 'effect';
import { enforce } from './internal/invariants.js';
import { decideBy, decideIn, transition } from './internal/transition.js';
export const make = (definition) => ({
    ...definition,
    invariants: definition.invariants ?? {}
});
/**
 * Handles commands for keys of a Store service: loads the state (or `initial`), decides with the
 * command's handler, folds the events, checks the invariants on the state they reach and saves, in
 * one transaction, traced as the span `Decider.handle`. Resolves after the commit with the events
 * and the state they reached; a rejection fails the Effect and a broken invariant dies with
 * `Program.InvariantBroken`. The events and rejections are those of the command's handler.
 */
export const handle = (decider, Store) => {
    const decide = decideBy(decider);
    const rule = transition({
        decide: (state, command) => Effect.sync(() => decide(state, command)),
        evolve: (state, event) => Effect.sync(() => decider.evolve(state, event)),
        holds: enforce(decider.invariants, decider.State)
    });
    const traced = Effect.fn('Decider.handle')(function* (key, command) {
        const { decided, reached } = yield* decideIn(decider, yield* Store, rule)(key, command);
        return { events: yield* Effect.fromResult(decided), state: reached };
    });
    // SAFETY: each command runs only the handler of its own tag, so it gives only that handler's
    // events and rejections; `Handlers` requires every handler to give a subset of the whole unions.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TypeScript can't relate a command to its tag's handler
    return traced;
};
//# sourceMappingURL=Decider.js.map