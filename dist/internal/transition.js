/**
 * A Decider's transition, shared by `Decider.handle` and the tales: decide a command, fold its
 * events into every state they pass through and check the invariants on the state reached.
 * `handle` runs it with the plain callbacks, tales with strictly checked ones.
 */
import { Effect, Option, Result } from 'effect';
/** A command's tag, typed as the tag of its own case, which picks that case's handler. */
const tagOf = (command) => command._tag;
/** A Decider's `decide` as one function: each command goes to the handler of its tag. */
export const decideBy = (decider) => (state, command) => decider.decide[tagOf(command)](state, command);
/** Decides a command and folds its events; the invariants must hold once they are all applied. */
export const transition = (steps) => Effect.fnUntraced(function* (state, command) {
    const decided = yield* steps.decide(state, command);
    // Stryker disable next-line ArrayDeclaration: only a tale's cases read states, and a non-state names no case
    if (Result.isFailure(decided))
        return { decided, reached: state, states: [] };
    // Stryker disable next-line ArrayDeclaration: only a tale's cases read states, and a non-state names no case
    const states = [];
    let reached = state;
    for (const event of decided.success) {
        reached = yield* steps.evolve(reached, event);
        states.push(reached);
    }
    yield* steps.holds(reached);
    return { decided, reached, states };
});
/** Loads the state under `key`, or the Decider's `initial` when nothing was saved. */
export const loadOrInitial = (decider, store, key) => Effect.map(store.load(key), Option.getOrElse(() => decider.initial));
/**
 * Loads, transitions and saves (only when there are events) in one transaction of `store`. `rule`
 * is the plain transition for `handle` and the strictly checked one for `Decision.against`.
 */
export const decideIn = (decider, store, rule) => Effect.fnUntraced(function* (key, command) {
    const ruled = yield* rule(yield* loadOrInitial(decider, store, key), command);
    const { decided, reached } = ruled;
    if (Result.isSuccess(decided) && decided.success.length > 0) {
        yield* store.save(key, reached, decided.success);
    }
    return ruled;
}, store.transaction);
//# sourceMappingURL=transition.js.map