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

/** Loads, decides and saves (only when there are events) in one transaction of `store`. */
export const decideIn =
	<State, Input, Event, Rejection, Key, E>(
		decider: Decider<State, Input, Event, Rejection>,
		store: Store<Key, State, Event, E>
	) =>
	(key: Key, input: Input): Effect.Effect<Result.Result<ReadonlyArray<Event>, Rejection>, E> =>
		store.transaction(
			Effect.gen(function* () {
				const state = yield* loadOrInitial(decider, store, key);
				const decided = decider.decide(state, input);
				if (Result.isSuccess(decided) && decided.success.length > 0) {
					yield* store.save(key, decided.success.reduce(decider.evolve, state), decided.success);
				}
				return decided;
			})
		);
