/**
 * A Decider's transition, shared by `Decider.handle` and the tales: decide a command, fold its
 * events into every state they pass through and check the invariants on the state reached.
 * `handle` runs it with the plain callbacks, tales with strictly checked ones.
 */
import { Effect, Option, Result } from 'effect';
/** Decides a command and folds its events; the invariants must hold once they are all applied. */
export const transition = (steps) => (state, command) => Effect.gen(function* () {
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
export const decideIn = (decider, store, rule) => (key, command) => store.transaction(Effect.gen(function* () {
    const ruled = yield* rule(yield* loadOrInitial(decider, store, key), command);
    const { decided, reached } = ruled;
    if (Result.isSuccess(decided) && decided.success.length > 0) {
        yield* store.save(key, reached, decided.success);
    }
    return ruled;
}));
//# sourceMappingURL=transition.js.map