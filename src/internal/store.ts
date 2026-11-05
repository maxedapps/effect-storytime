/** Runs a Decider on a Store, shared by `Decider.handle` and `Decision.against`. */
import { Effect, Option, Result } from 'effect';
import type { Decider, Store } from '../Decider.ts';

/** Loads the state under `key`, or the Decider's `initial` when nothing was saved. */
export const loadOrInitial = <State, Input, Event, Rejection, Key, E>(
	decider: Decider<State, Input, Event, Rejection>,
	store: Store<Key, State, Event, E>,
	key: Key
): Effect.Effect<State, E> =>
	Effect.map(
		store.load(key),
		Option.getOrElse(() => decider.initial)
	);

/** What an input gave, events or a rejection, and the state its events reach. */
export interface Ruling<State, Event, Rejection> {
	readonly decided: Result.Result<ReadonlyArray<Event>, Rejection>;
	readonly reached: State;
}

/** Decides an input and folds its events into the state. */
export const rule =
	<State, Input, Event, Rejection>(decider: Decider<State, Input, Event, Rejection>) =>
	(state: State, input: Input): Effect.Effect<Ruling<State, Event, Rejection>> =>
		Effect.sync(() => {
			const decided = decider.decide(state, input);
			return {
				decided,
				reached: Result.isSuccess(decided) ? decided.success.reduce(decider.evolve, state) : state
			};
		});

/**
 * Loads, rules and saves (only when there are events) in one transaction of `store`, giving the
 * ruling. `ruling` is `rule` for `handle` and the strictly checked one for `Decision.against`.
 */
export const decideIn =
	<State, Input, Event, Rejection, Key, E, X>(
		decider: Decider<State, Input, Event, Rejection>,
		store: Store<Key, State, Event, E>,
		ruling: (state: State, input: Input) => Effect.Effect<Ruling<State, Event, Rejection>, X>
	) =>
	(key: Key, input: Input): Effect.Effect<Ruling<State, Event, Rejection>, E | X> =>
		store.transaction(
			Effect.gen(function* () {
				const ruled = yield* ruling(yield* loadOrInitial(decider, store, key), input);
				const { decided, reached } = ruled;
				if (Result.isSuccess(decided) && decided.success.length > 0) {
					yield* store.save(key, reached, decided.success);
				}
				return ruled;
			})
		);
