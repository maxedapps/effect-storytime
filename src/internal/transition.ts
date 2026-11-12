/**
 * A Decider's transition, shared by `Decider.handle` and the tales: decide a command, fold its
 * events into every state they pass through and check the invariants on the state reached.
 * `handle` runs it with the plain callbacks, tales with strictly checked ones.
 */
import { Effect, Option, Result } from 'effect';
import type { Decider, Store } from '../Decider.ts';

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
	readonly decide: (
		state: State,
		command: Command
	) => Effect.Effect<Result.Result<ReadonlyArray<Event>, Rejection>, X>;
	readonly evolve: (state: State, event: Event) => Effect.Effect<State, X>;
	readonly holds: (state: State) => Effect.Effect<void, X>;
}

/** Decides a command and folds its events; the invariants must hold once they are all applied. */
export const transition =
	<State, Command, Event, Rejection, X>(steps: Steps<State, Command, Event, Rejection, X>) =>
	(state: State, command: Command): Effect.Effect<Transition<State, Event, Rejection>, X> =>
		Effect.gen(function* () {
			const decided = yield* steps.decide(state, command);
			// Stryker disable next-line ArrayDeclaration: only a tale's cases read states, and a non-state names no case
			if (Result.isFailure(decided)) return { decided, reached: state, states: [] };
			// Stryker disable next-line ArrayDeclaration: only a tale's cases read states, and a non-state names no case
			const states: Array<State> = [];
			let reached = state;
			for (const event of decided.success) {
				reached = yield* steps.evolve(reached, event);
				states.push(reached);
			}
			yield* steps.holds(reached);
			return { decided, reached, states };
		});

/** Loads the state under `key`, or the Decider's `initial` when nothing was saved. */
export const loadOrInitial = <State, Command, Event, Rejection, Key, E>(
	decider: Decider<State, Command, Event, Rejection>,
	store: Store<Key, State, Event, E>,
	key: Key
): Effect.Effect<State, E> =>
	Effect.map(
		store.load(key),
		Option.getOrElse(() => decider.initial)
	);

/**
 * Loads, transitions and saves (only when there are events) in one transaction of `store`. `rule`
 * is the plain transition for `handle` and the strictly checked one for `Decision.against`.
 */
export const decideIn =
	<State, Command, Event, Rejection, Key, E, X>(
		decider: Decider<State, Command, Event, Rejection>,
		store: Store<Key, State, Event, E>,
		rule: (state: State, command: Command) => Effect.Effect<Transition<State, Event, Rejection>, X>
	) =>
	(key: Key, command: Command): Effect.Effect<Transition<State, Event, Rejection>, E | X> =>
		store.transaction(
			Effect.gen(function* () {
				const ruled = yield* rule(yield* loadOrInitial(decider, store, key), command);
				const { decided, reached } = ruled;
				if (Result.isSuccess(decided) && decided.success.length > 0) {
					yield* store.save(key, reached, decided.success);
				}
				return ruled;
			})
		);
