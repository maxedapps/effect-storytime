/**
 * A Decider is the command side of a consistency boundary: `decide` turns a state and a command
 * into events or a rejection, `evolve` folds an event into the state, and named invariants say
 * which states may exist. `handle` runs it on a Store in one transaction, which makes it an
 * aggregate.
 */
import { Effect } from 'effect';
import type { Context, Option, Result, Schema } from 'effect';
import { describer } from './internal/canonical.ts';
import { enforce } from './internal/invariants.ts';
import { decideIn, transition } from './internal/transition.ts';
import type { Invariants } from './Program.ts';

export interface Decider<State, Command, Event, Rejection> {
	readonly State: Schema.Codec<State, unknown>;
	readonly Command: Schema.Codec<Command, unknown>;
	readonly Event: Schema.Codec<Event, unknown>;
	readonly Rejection: Schema.Codec<Rejection, unknown>;
	/** The state of a key nothing was saved for yet. */
	readonly initial: State;
	readonly decide: (
		state: State,
		command: Command
	) => Result.Result<ReadonlyArray<Event>, Rejection>;
	readonly evolve: (state: State, event: Event) => State;
	readonly invariants: Invariants<State>;
}

export interface Definition<State, Command, Event, Rejection> {
	readonly State: Schema.Codec<State, unknown>;
	readonly Command: Schema.Codec<Command, unknown>;
	readonly Event: Schema.Codec<Event, unknown>;
	readonly Rejection: Schema.Codec<Rejection, unknown>;
	readonly initial: State;
	readonly decide: (
		state: State,
		command: Command
	) => Result.Result<ReadonlyArray<Event>, Rejection>;
	readonly evolve: (state: State, event: Event) => State;
	/** Named predicates every state must satisfy, checked by `handle` on the state each command reaches, before it saves. */
	readonly invariants?: Invariants<State>;
}

export const make = <State, Command, Event, Rejection>(
	definition: Definition<State, Command, Event, Rejection>
): Decider<State, Command, Event, Rejection> => ({
	...definition,
	invariants: definition.invariants ?? {}
});

/**
 * Where a Decider's states live: one row or several tables, implemented by the app as a
 * `Context.Service`. `save` gets the events too, so a store may keep them.
 *
 * The contract `handle` relies on: `transaction` protects everything `load` read until `save`
 * commits, so no concurrent command decides on the same state (SERIALIZABLE with retries, or
 * writes guarded by a version), `load` gives back exactly what `save` stored, and `transaction` is
 * the outermost transaction, so `handle` resolves only after its commit. Run `handle` inside no
 * other transaction: a nested one keeps the outer isolation and commits only with it.
 */
export interface Store<Key, State, Event, E = never> {
	readonly load: (key: Key) => Effect.Effect<Option.Option<State>, E>;
	readonly save: (key: Key, state: State, events: ReadonlyArray<Event>) => Effect.Effect<void, E>;
	readonly transaction: <A, E2, R>(effect: Effect.Effect<A, E2, R>) => Effect.Effect<A, E | E2, R>;
}

/** What `handle` committed: the events and the state they reached. */
export interface Handled<State, Event> {
	readonly events: ReadonlyArray<Event>;
	readonly state: State;
}

/**
 * Handles commands for keys of a Store service: loads the state (or `initial`), decides, folds the
 * events, checks the invariants on the state they reach and saves, in one transaction, traced as
 * the span `Decider.handle`. Resolves after the commit with the events and the state they reached;
 * a rejection fails the Effect and a broken invariant dies with `Program.InvariantBroken`.
 */
export const handle = <State, Command, Event, Rejection, Id, Key, E>(
	decider: Decider<State, Command, Event, Rejection>,
	Store: Context.Key<Id, Store<Key, State, Event, E>>
) => {
	const rule = transition<State, Command, Event, Rejection, never>({
		decide: (state, command) => Effect.sync(() => decider.decide(state, command)),
		evolve: (state, event) => Effect.sync(() => decider.evolve(state, event)),
		holds: enforce(decider.invariants, describer(decider.State))
	});
	return Effect.fn('Decider.handle')(function* (
		key: Key,
		command: Command
	): Effect.fn.Return<Handled<State, Event>, Rejection | E, Id> {
		const { decided, reached } = yield* decideIn(decider, yield* Store, rule)(key, command);
		return { events: yield* Effect.fromResult(decided), state: reached };
	});
};
