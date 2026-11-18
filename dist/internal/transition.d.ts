/**
 * A Decider's transition, shared by `Decider.handle` and the tales: decide a command, fold its
 * events into every state they pass through and check the invariants on the state reached.
 * `handle` runs it with the plain callbacks, tales with strictly checked ones.
 */
import { Effect, Result } from 'effect';
import type { Decider, Store } from '../Decider.ts';
import type { Tagged } from '../Program.ts';
/** What a command gave, events or a rejection, and the states its events reached. */
export interface Transition<State, Event, Rejection> {
    readonly decided: Result.Result<ReadonlyArray<Event>, Rejection>;
    /** The last state the events reached; the state decided on when there are none. */
    readonly reached: State;
    /** Every state the events passed through, in order. */
    readonly states: ReadonlyArray<State>;
}
/** How a transition runs a Decider's callbacks and checks its invariants. */
export interface Steps<State, Command, Event, Rejection, X> {
    readonly decide: (state: State, command: Command) => Effect.Effect<Result.Result<ReadonlyArray<Event>, Rejection>, X>;
    readonly evolve: (state: State, event: Event) => Effect.Effect<State, X>;
    readonly holds: (state: State) => Effect.Effect<void, X>;
}
/** A Decider's `decide` as one function: each command goes to the handler of its tag. */
export declare const decideBy: <State, Command extends Tagged, Event, Rejection>(decider: Decider<State, Command, Event, Rejection>) => (state: State, command: Command) => Result.Result<ReadonlyArray<Event>, Rejection>;
/** Decides a command and folds its events; the invariants must hold once they are all applied. */
export declare const transition: <State, Command, Event, Rejection, X>(steps: Steps<State, Command, Event, Rejection, X>) => (state: State, command: Command) => Effect.Effect<Transition<State, Event, Rejection>, X, never>;
/** Loads the state under `key`, or the Decider's `initial` when nothing was saved. */
export declare const loadOrInitial: <State, Command extends Tagged, Event, Rejection, Key, E>(decider: Decider<State, Command, Event, Rejection>, store: Store<Key, State, Event, E>, key: Key) => Effect.Effect<State, E>;
/**
 * Loads, transitions and saves (only when there are events) in one transaction of `store`. `rule`
 * is the plain transition for `handle` and the strictly checked one for `Decision.against`.
 */
export declare const decideIn: <State, Command extends Tagged, Event, Rejection, Key, E, X>(decider: Decider<State, Command, Event, Rejection>, store: Store<Key, State, Event, E>, rule: (state: State, command: Command) => Effect.Effect<Transition<State, Event, Rejection>, X>) => (key: Key, command: Command) => Effect.Effect<Transition<State, Event, Rejection>, E | X, never>;
//# sourceMappingURL=transition.d.ts.map