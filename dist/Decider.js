/**
 * A Decider is a pure rule for one stored row: `decide` turns a state and an input into events or a
 * rejection, `evolve` folds an event into the state. `handle` runs it on a Store in one transaction.
 */
import { Effect } from 'effect';
import { decideIn, rule } from './internal/store.js';
export const make = (definition) => ({
    ...definition,
    invariants: definition.invariants ?? {}
});
/**
 * Handles inputs for keys of a Store service: loads the state (or `initial`), decides, folds the
 * events and saves them in one transaction. A rejection fails the Effect.
 */
export const handle = (decider, Store) => (key, input) => Effect.flatMap(Store, (store) => Effect.flatMap(decideIn(decider, store, rule(decider))(key, input), Effect.fromResult));
//# sourceMappingURL=Decider.js.map