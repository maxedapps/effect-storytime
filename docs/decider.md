# Decider

`import { Decider } from 'effect-storytime'`

A Decider is the command side of one consistency boundary. `decide` turns a state and a command into events or a rejection, `evolve` folds an event into the state, and named invariants say which states may exist. `Decider.handle` runs it on a Store in one transaction. See [domain-modelling.md](domain-modelling.md) for when to use one.

## Defining a Decider

The membership example: a course membership is granted by a source, checked against it now and then, and revoked. Its Schemas come first.

<!-- snippet: test/examples/membership.ts#schemas -->
```ts
const Source = Schema.Literals(['manual', 'teachable']);

export const Membership = Schema.Struct({
	source: Source,
	active: Schema.BooleanFromBit,
	checkedAt: Schema.NullOr(Schema.NonEmptyString)
});
export type Membership = typeof Membership.Type;

export const Command = Schema.TaggedUnion({
	Grant: { source: Source, at: Schema.NonEmptyString },
	Check: { active: Schema.Boolean, at: Schema.NonEmptyString },
	Revoke: {}
});
export type Command = typeof Command.Type;

export const Event = Schema.TaggedUnion({
	Granted: { source: Source, at: Schema.NonEmptyString },
	Checked: { active: Schema.Boolean, at: Schema.NonEmptyString },
	Revoked: {}
});
export type Event = typeof Event.Type;

export const Rejection = Schema.TaggedUnion({
	AlreadyActive: { since: Schema.NullOr(Schema.NonEmptyString) },
	NotActive: {},
	Manual: {}
});
export type Rejection = typeof Rejection.Type;

export const { Grant, Check, Revoke } = Command.cases;
export const { Granted, Checked, Revoked } = Event.cases;
export const { AlreadyActive, NotActive, Manual } = Rejection.cases;
```

Then the rules. `decide` returns an Effect `Result`: `Result.succeed(events)` to accept, `Result.fail(rejection)` to reject. An accepted command may give no events (`Result.succeed([])`), which `handle` treats as a no-op.

<!-- snippet: test/examples/membership.ts#decider -->
```ts
const decide = (
	current: Membership,
	command: Command
): Result.Result<ReadonlyArray<Event>, Rejection> =>
	Command.match(command, {
		Grant: ({ source, at }) =>
			current.active
				? Result.fail(AlreadyActive.make({ since: current.checkedAt }))
				: Result.succeed([Granted.make({ source, at })]),
		Check: ({ active, at }) =>
			current.source === 'manual'
				? Result.fail(Manual.make({}))
				: Result.succeed(active === current.active ? [] : [Checked.make({ active, at })]),
		Revoke: () =>
			current.active ? Result.succeed([Revoked.make({})]) : Result.fail(NotActive.make({}))
	});

const evolve = (current: Membership, event: Event): Membership =>
	Event.match(event, {
		Granted: ({ source, at }) => ({ source, active: true, checkedAt: at }),
		Checked: ({ active, at }) => ({ ...current, active, checkedAt: at }),
		Revoked: () => ({ ...current, active: false })
	});

export const none: Membership = { source: 'teachable', active: false, checkedAt: null };

export const membership = Decider.make({
	State: Membership,
	Command,
	Event,
	Rejection,
	initial: none,
	decide,
	evolve,
	invariants: { checkedWhenActive: (current) => !current.active || current.checkedAt !== null }
});
```

`Decider.make(definition)` takes:

| Field | Type | Meaning |
| --- | --- | --- |
| `State` | `Schema.Codec<State, unknown>` | The state of one key. A struct or a tagged union. |
| `Command` | `Schema.Codec<Command, unknown>` | What callers ask for. Use a `Schema.TaggedUnion`. |
| `Event` | `Schema.Codec<Event, unknown>` | What happened. Use a `Schema.TaggedUnion`. |
| `Rejection` | `Schema.Codec<Rejection, unknown>` | Why a command was refused. Use a `Schema.TaggedUnion`, so `Effect.catchTag` can handle each case. |
| `initial` | `State` | The state of a key nothing was saved for yet. |
| `decide` | `(state, command) => Result<ReadonlyArray<Event>, Rejection>` | Pure. Events in the order they happen. |
| `evolve` | `(state, event) => State` | Pure. Folds one event. |
| `invariants` | `Record<string, (state) => boolean>`, optional | Named predicates every state must satisfy. `{}` by default. |

It returns a `Decider<State, Command, Event, Rejection>`: the same fields, with `invariants` always present. The value is plain data, so `Decider.make({ ...membership, decide: other })` builds a variant.

## Handling commands

`Decider.handle(decider, Store)` takes the Decider and the `Context.Service` class of its Store and returns `(key, command) => Effect<Handled<State, Event>, Rejection | E, Store>`. One call runs one transaction:

1. `load(key)`, or `initial` when it gives `Option.none()`.
2. `decide(state, command)`. A rejection fails the Effect with the rejection, and nothing is saved.
3. `evolve` folds each event, and every invariant is checked once, on the state the last event reached. The states in between aren't checked, so a command's events may pass through a state that only its last event resolves.
4. `save(key, state, events)`, unless there are no events.

It resolves after the commit with `{ events, state }`: the events and the state they reached, or the loaded state when there were no events. Each call runs in a tracing span named `Decider.handle`, with the Store's transaction inside it, so a tracer shows every command and what its Store did.

<!-- snippet: test/docs/membership.test.ts#handle -->
```ts
const grant = Decider.handle(membership, Memberships);

const { events, state } = yield* grant('user-2', Grant.make({ source: 'teachable', at }));
expect(events).toEqual([Granted.make({ source: 'teachable', at })]);
expect(state).toEqual({ source: 'teachable', active: true, checkedAt: at });

// A rejection is the typed error, and nothing is saved.
const again = yield* grant('user-2', Grant.make({ source: 'teachable', at: later })).pipe(
	Effect.catchTag('AlreadyActive', ({ since }) => Effect.succeed(`active since ${since}`))
);
expect(again).toBe(`active since ${at}`);
```

### A broken invariant

A state that breaks an invariant is a bug in `decide` or `evolve`, so `handle` dies with the defect `Program.InvariantBroken { invariant, state }` inside the transaction, and nothing is saved. Programs and Deciders share this one defect. `state` is the state as a line, in canonical JSON. Tales catch this before it reaches `handle` ([strict-rules.md](strict-rules.md)).

<!-- snippet: test/docs/membership.test.ts#invariant -->
```ts
// A bug: this evolve forgets when a granted membership was checked.
const careless = Decider.make({
	...membership,
	evolve: (state, event) =>
		Event.guards.Granted(event) ? { ...state, active: true } : membership.evolve(state, event)
});
const defect = yield* Decider.handle(careless, Memberships)(
	'user-3',
	Grant.make({ source: 'teachable', at })
).pipe(Effect.catchDefect(Effect.succeed));
expect(defect).toEqual(
	new Program.InvariantBroken({
		invariant: 'checkedWhenActive',
		state: '{"active":1,"checkedAt":null,"source":"teachable"}'
	})
);
// Nothing was saved: the key still has no state.
const store = yield* Memberships;
expect(yield* store.load('user-3')).toEqual(Option.none());
```

## The Store

A `Decider.Store<Key, State, Event, E = never>` is where a Decider's states live, implemented by your app as a `Context.Service`:

| Member | Type | Meaning |
| --- | --- | --- |
| `load` | `(key) => Effect<Option<State>, E>` | The saved state, or `Option.none()` for a new key. |
| `save` | `(key, state, events) => Effect<void, E>` | Stores the state. It gets the events too, so it may keep them as a history or an outbox. |
| `transaction` | `<A, E2, R>(effect) => Effect<A, E \| E2, R>` | Runs one `handle` call. |

`handle` relies on this contract:

- **Isolation.** `transaction` protects everything `load` read until `save` commits, so no concurrent command decides on the same state. Use SERIALIZABLE with retries, or writes guarded by a version.
- **Round trip.** `load` gives back exactly what `save` stored.
- **Commit.** `transaction` is the outermost transaction, so `handle` resolves only after its commit. Don't run `handle` inside another transaction: a nested one keeps the outer isolation and commits only with it.

A Store may span one row or several tables. The state is the truth; there is no event store ([ADR 0003](../adrs/0003-lean-domain-library.md)).

### A Store on `effect/sql`

The membership Store on Postgres. A SERIALIZABLE conflict retries the whole transaction, which loads and decides again.

<!-- snippet: test/examples/memberships-sql.ts#store -->
```ts
import { Context, Effect, Layer, Predicate, Schema } from 'effect';
import { SqlClient, SqlError, SqlSchema } from 'effect/sql';
import type { Decider } from 'effect-storytime';
import { Membership } from './membership.ts';
import type { Event } from './membership.ts';

const Row = Schema.Struct({ ...Membership.fields, userId: Schema.String });

export class Memberships extends Context.Service<
	Memberships,
	Decider.Store<string, Membership, Event, SqlError.SqlError | Schema.SchemaError>
>()('Memberships') {
	static readonly layer = Layer.effect(
		Memberships,
		Effect.gen(function* () {
			// A client that maps camelCase fields to snake_case columns and back.
			const sql = yield* SqlClient.SqlClient;
			const find = SqlSchema.findOneOption({
				Request: Schema.String,
				Result: Membership,
				execute: (userId) =>
					sql`SELECT source, active, checked_at FROM memberships WHERE user_id = ${userId}`
			});
			return Memberships.of({
				load: find,
				save: (userId, state, events) =>
					Effect.gen(function* () {
						const row = yield* Schema.encodeEffect(Row)({ ...state, userId });
						yield* sql`INSERT INTO memberships ${sql.insert(row)}
							ON CONFLICT (user_id) DO UPDATE SET ${sql.update(row, ['userId'])}`;
						// The state is the truth; the events may be kept as a history.
						yield* Effect.forEach(
							events,
							(event) =>
								sql`INSERT INTO membership_history ${sql.insert({ userId, kind: event._tag })}`,
							{ discard: true }
						);
					}),
				// SERIALIZABLE protects everything `load` read; a conflict retries the whole decision.
				transaction: (effect) =>
					sql.withTransaction(effect).pipe(
						Effect.provideService(SqlClient.BeginTransaction, 'BEGIN ISOLATION LEVEL SERIALIZABLE'),
						Effect.retry({
							while: (error) =>
								SqlError.isSqlError(error) &&
								(Predicate.isTagged(error.reason, 'SerializationError') ||
									Predicate.isTagged(error.reason, 'DeadlockError')),
							times: 5
						})
					)
			});
		})
	);
}
```

### A Store in memory

For tests and examples, a `Ref` of rows and a one-permit semaphore give the same contract: one transaction runs at a time, which isolates every decision.

<!-- snippet: test/examples/awarding.ts#store -->
```ts
/** Badges in memory for tests: one transaction at a time, which isolates every decision. */
export class Badges extends Context.Service<Badges, Decider.Store<string, Earned, Event>>()(
	'test/Badges'
) {
	static readonly layer = Layer.effect(
		Badges,
		Effect.gen(function* () {
			const rows = yield* Ref.make(new Map<string, Earned>());
			const one = yield* Semaphore.make(1);
			return Badges.of({
				load: (learner) =>
					Effect.map(Ref.get(rows), (all) => Option.fromUndefinedOr(all.get(learner))),
				save: (learner, earned) => Ref.update(rows, (all) => new Map(all).set(learner, earned)),
				transaction: one.withPermits(1)
			});
		})
	);
}
```

Test a real Store with the same decisions you run in memory: `Decision.against` ([decisions.md](decisions.md)).

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `make(definition)` | function | Builds a `Decider`, defaulting `invariants` to `{}`. |
| `handle(decider, Store)` | function | Gives `(key, command) => Effect<Handled, Rejection \| E, Store>`. |
| `Decider<State, Command, Event, Rejection>` | interface | What `make` returns. |
| `Definition<State, Command, Event, Rejection>` | interface | What `make` takes. |
| `Store<Key, State, Event, E>` | interface | `load`, `save`, `transaction`. |
| `Handled<State, Event>` | interface | `{ events, state }`, what `handle` resolves with. |
