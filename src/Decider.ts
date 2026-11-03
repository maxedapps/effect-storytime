/**
 * A Decider is a pure rule for one stored row: `decide` turns a state and an input into events or a
 * rejection, `evolve` folds an event into the state. `handle` runs it on a Store in one transaction.
 */
import { Effect } from 'effect';
import type { Context, Option, Result, Schema } from 'effect';
import { decideIn } from './internal/store.ts';
import type { Invariants } from './Program.ts';

export interface Decider<State, Input, Event, Rejection> {
	readonly State: Schema.Codec<State, unknown>;
	readonly Input: Schema.Codec<Input, unknown>;
	readonly Event: Schema.Codec<Event, unknown>;
	readonly Rejection: Schema.Codec<Rejection, unknown>;
	/** The state of a key nothing was saved for yet. */
	readonly initial: State;
	readonly decide: (state: State, input: Input) => Result.Result<ReadonlyArray<Event>, Rejection>;
	readonly evolve: (state: State, event: Event) => State;
	readonly invariants: Invariants<State>;
}

export interface Definition<State, Input, Event, Rejection> {
	readonly State: Schema.Codec<State, unknown>;
	readonly Input: Schema.Codec<Input, unknown>;
	readonly Event: Schema.Codec<Event, unknown>;
	readonly Rejection: Schema.Codec<Rejection, unknown>;
	readonly initial: State;
	readonly decide: (state: State, input: Input) => Result.Result<ReadonlyArray<Event>, Rejection>;
	readonly evolve: (state: State, event: Event) => State;
	readonly invariants?: Invariants<State>;
}

export const make = <State, Input, Event, Rejection>(
	definition: Definition<State, Input, Event, Rejection>
): Decider<State, Input, Event, Rejection> => ({
	...definition,
	invariants: definition.invariants ?? {}
});

/**
 * Where a Decider's states live, such as a database table. An app implements it as a
 * `Context.Service`; `save` gets the events too, so a store may keep them.
 */
export interface Store<Key, State, Event, E = never> {
	readonly load: (key: Key) => Effect.Effect<Option.Option<State>, E>;
	readonly save: (key: Key, state: State, events: ReadonlyArray<Event>) => Effect.Effect<void, E>;
	readonly transaction: <A, E2, R>(effect: Effect.Effect<A, E2, R>) => Effect.Effect<A, E | E2, R>;
}

/**
 * Handles inputs for keys of a Store service: loads the state (or `initial`), decides, folds the
 * events and saves them in one transaction. A rejection fails the Effect.
 */
export const handle =
	<State, Input, Event, Rejection, Id, Key, E>(
		decider: Decider<State, Input, Event, Rejection>,
		Store: Context.Key<Id, Store<Key, State, Event, E>>
	) =>
	(key: Key, input: Input): Effect.Effect<ReadonlyArray<Event>, Rejection | E, Id> =>
		Effect.flatMap(Store, (store) =>
			Effect.flatMap(decideIn(decider, store)(key, input), Effect.fromResult)
		);
