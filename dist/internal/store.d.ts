/** Runs a Decider on a Store, shared by `Decider.handle` and `Decision.against`. */
import { Effect, Result } from 'effect';
import type { Decider, Store } from '../Decider.ts';
/** Loads the state under `key`, or the Decider's `initial` when nothing was saved. */
export declare const loadOrInitial: <State, Input, Event, Rejection, Key, E>(decider: Decider<State, Input, Event, Rejection>, store: Store<Key, State, Event, E>, key: Key) => Effect.Effect<State, E>;
/** What an input gave, events or a rejection, and the state its events reach. */
export interface Ruling<State, Event, Rejection> {
    readonly decided: Result.Result<ReadonlyArray<Event>, Rejection>;
    readonly reached: State;
}
/** Decides an input and folds its events into the state. */
export declare const rule: <State, Input, Event, Rejection>(decider: Decider<State, Input, Event, Rejection>) => (state: State, input: Input) => Effect.Effect<Ruling<State, Event, Rejection>>;
/**
 * Loads, rules and saves (only when there are events) in one transaction of `store`. `ruling`
 * is `rule` for `handle` and the strictly checked one for `Decision.against`.
 */
export declare const decideIn: <State, Input, Event, Rejection, Key, E, X>(decider: Decider<State, Input, Event, Rejection>, store: Store<Key, State, Event, E>, ruling: (state: State, input: Input) => Effect.Effect<Ruling<State, Event, Rejection>, X>) => (key: Key, input: Input) => Effect.Effect<Result.Result<ReadonlyArray<Event>, Rejection>, E | X>;
