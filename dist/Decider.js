/**
 * A Decider is the command side of a consistency boundary: `decide` turns a state and a command
 * into events or a rejection, `evolve` folds an event into the state, and named invariants say
 * which states may exist. `handle` runs it on a Store in one transaction, which makes it an
 * aggregate.
 */
import { Effect } from 'effect';
import { enforce } from './internal/invariants.js';
import { decideIn, transition } from './internal/transition.js';
export const make = (definition) => ({
    ...definition,
    invariants: definition.invariants ?? {}
});
/**
 * Handles commands for keys of a Store service: loads the state (or `initial`), decides, folds the
 * events, checks the invariants on the state they reach and saves, in one transaction, traced as
 * the span `Decider.handle`. Resolves after the commit with the events and the state they reached;
 * a rejection fails the Effect and a broken invariant dies with `Program.InvariantBroken`.
 */
export const handle = (decider, Store) => {
    const rule = transition({
        decide: (state, command) => Effect.sync(() => decider.decide(state, command)),
        evolve: (state, event) => Effect.sync(() => decider.evolve(state, event)),
        holds: enforce(decider.invariants, decider.State)
    });
    return Effect.fn('Decider.handle')(function* (key, command) {
        const { decided, reached } = yield* decideIn(decider, yield* Store, rule)(key, command);
        return { events: yield* Effect.fromResult(decided), state: reached };
    });
};
//# sourceMappingURL=Decider.js.map