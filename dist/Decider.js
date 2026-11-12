/**
 * A Decider is the command side of a consistency boundary: `decide` turns a state and a command
 * into events or a rejection, `evolve` folds an event into the state, and named invariants say
 * which states may exist. `handle` runs it on a Store in one transaction, which makes it an
 * aggregate.
 */
import { Array as Arr, Effect, Option, Schema } from 'effect';
import { describer } from './internal/canonical.js';
import { decideIn, transition } from './internal/transition.js';
export const make = (definition) => ({
    ...definition,
    invariants: definition.invariants ?? {}
});
/**
 * The defect `handle` dies with when a command's events reach a state that breaks an invariant.
 * It dies inside the transaction, so nothing is saved.
 */
export class InvariantBroken extends Schema.TaggedError()('InvariantBroken', {
    invariant: Schema.String,
    /** The state as a line, as stories show it. */
    state: Schema.String
}) {
    get message() {
        return `invariant ${this.invariant} does not hold for ${this.state}`;
    }
}
/**
 * Handles commands for keys of a Store service: loads the state (or `initial`), decides, folds the
 * events, checks the invariants and saves, in one transaction. Resolves after the commit with the
 * events and the state they reached; a rejection fails the Effect.
 */
export const handle = (decider, Store) => {
    const show = describer(decider.State);
    const rule = transition({
        decide: (state, command) => Effect.sync(() => decider.decide(state, command)),
        evolve: (state, event) => Effect.sync(() => decider.evolve(state, event)),
        holds: (state) => Effect.suspend(() => Option.match(Arr.findFirst(Object.entries(decider.invariants), ([, holds]) => !holds(state)), {
            onNone: () => Effect.void,
            onSome: ([invariant]) => Effect.die(new InvariantBroken({ invariant, state: show(state) }))
        }))
    });
    return (key, command) => Effect.flatMap(Store, (store) => Effect.flatMap(decideIn(decider, store, rule)(key, command), ({ decided, reached }) => Effect.map(Effect.fromResult(decided), (events) => ({ events, state: reached }))));
};
//# sourceMappingURL=Decider.js.map