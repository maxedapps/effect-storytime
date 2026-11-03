/** Runs a Decider on a Store, shared by `Decider.handle` and `Decision.against`. */
import { Effect, Option, Result } from 'effect';
/** Loads the state under `key`, or the Decider's `initial` when nothing was saved. */
export const loadOrInitial = (decider, store, key) => Effect.map(store.load(key), Option.getOrElse(() => decider.initial));
/** Decides an input and folds its events into the state. */
export const rule = (decider) => (state, input) => Effect.sync(() => {
    const decided = decider.decide(state, input);
    return {
        decided,
        reached: Result.isSuccess(decided) ? decided.success.reduce(decider.evolve, state) : state
    };
});
/**
 * Loads, rules and saves (only when there are events) in one transaction of `store`. `ruling`
 * is `rule` for `handle` and the strictly checked one for `Decision.against`.
 */
export const decideIn = (decider, store, ruling) => (key, input) => store.transaction(Effect.gen(function* () {
    const { decided, reached } = yield* ruling(yield* loadOrInitial(decider, store, key), input);
    if (Result.isSuccess(decided) && decided.success.length > 0) {
        yield* store.save(key, reached, decided.success);
    }
    return decided;
}));
//# sourceMappingURL=store.js.map