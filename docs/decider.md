# Decider

`import { Decider } from 'effect-storytime'`

A Decider is the command side of one consistency boundary. `decide` holds one handler per command, which turns a state and that command into events or a rejection, `evolve` folds an event into the state, and named invariants say which states may exist. `Decider.handle` runs it on a Store in one transaction. See [domain-modelling.md](domain-modelling.md) for when to use one.

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

Then the rules. `decide` is a record with one handler per command tag; each takes the state and the command of its tag and returns an Effect `Result`: `Result.succeed(events)` to accept, `Result.fail(rejection)` to reject. An accepted command may give no events (`Result.succeed([])`), which `handle` treats as a no-op. Leave each handler's return type inferred: it is that command's contract, the events and rejections `handle` types its calls with. A handler that returns an event or rejection outside the Decider's Schemas, or a missing handler, is a compile error on its own line.

<!-- snippet: test/examples/membership.ts#decider -->
```ts
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
	// One handler per command; what each returns is that command's contract.
	decide: {
		Grant: (current, { source, at }) =>
			current.active
				? Result.fail(AlreadyActive.make({ since: current.checkedAt }))
				: Result.succeed([Granted.make({ source, at })]),
		Check: (current, { active, at }) =>
			current.source === 'manual'
				? Result.fail(Manual.make({}))
				: Result.succeed(active === current.active ? [] : [Checked.make({ active, at })]),
		Revoke: (current) =>
			current.active ? Result.succeed([Revoked.make({})]) : Result.fail(NotActive.make({}))
	},
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
| `decide` | `{ [Tag]: (state, command) => Result<ReadonlyArray<Event>, Rejection> }` | One pure handler per command tag. Events in the order they happen. |
| `evolve` | `(state, event) => State` | Pure. Folds one event. |
| `invariants` | `Record<string, (state) => boolean>`, optional | Named predicates every state must satisfy. `{}` by default. |

It returns a `Decider<State, Command, Event, Rejection, Decide>`, `Decide` being the handlers' own types: the same fields, with `invariants` always present. The value is plain data, so `Decider.make({ ...membership, decide: { ...membership.decide, Revoke: other } })` builds a variant, and a test calls one rule as `membership.decide.Grant(state, command)`.

## Handling commands

`Decider.handle(decider, Store)` takes the Decider and the `Context.Service` class of its Store and returns `<C extends Command>(key, command: C) => Effect<Handled<State, EventOf<C>>, RejectionOf<C> | E, Store>`: a call gives only the events and rejections of its command's handler, so a new rejection on one command is a compile error at the callers that send it, not a surprise at runtime. A command typed as the whole union gives every handler's. One call runs one transaction:

1. `load(key)`, or `initial` when it gives `Option.none()`.
2. The handler of the command's tag, on the state and the command. A rejection fails the Effect with the rejection, and nothing is saved.
3. `evolve` folds each event, and every invariant is checked once, on the state the last event reached. The states in between aren't checked, so a command's events may pass through a state that only its last event resolves.
4. `save(key, state, events)`, unless there are no events.

It resolves after the commit with `{ events, state }`: the events and the state they reached, or the loaded state when there were no events. Each call runs in a tracing span named `Decider.handle`, with the Store's transaction inside it, so a tracer shows every command and what its Store did.

<!-- snippet: test/docs/membership.test.ts#handle -->
```ts
const handled = Decider.handle(membership, Memberships);

const { events, state } = yield* handled('user-2', Grant.make({ source: 'teachable', at }));
expect(events).toEqual([Granted.make({ source: 'teachable', at })]);
expect(state).toEqual({ source: 'teachable', active: true, checkedAt: at });

// A rejection is the typed error, and nothing is saved. The Grant handler rejects only
// with AlreadyActive, so catching it leaves no error.
const again: Effect.Effect<string, never, Memberships> = handled(
	'user-2',
	Grant.make({ source: 'teachable', at: later })
).pipe(
	Effect.as('granted'),
	Effect.catchTag('AlreadyActive', ({ since }) => Effect.succeed(`active since ${since}`))
);
expect(yield* again).toBe(`active since ${at}`);
```

### Keeping the types narrow

A handler's inferred return type is its command's contract, so a type annotation that names a whole union widens it again. A helper the handler calls that is typed as returning `Rejection` makes every call of that command fail with any rejection; a helper around `handle` that takes `Command` gives every handler's events and rejections. Leave a helper's return type inferred, or name the exact cases, and make a helper that takes a command generic in it (`<C extends Command>(key, command: C)`).

<!-- snippet: test/docs/membership.test.ts#widening -->
```ts
// A helper typed with the whole Rejection union widens the handler that calls it:
// Revoke's calls could now fail with any rejection.
const requireActiveWide = (current: Membership): Result.Result<Membership, Rejection> =>
	current.active ? Result.succeed(current) : Result.fail(NotActive.make({}));
// The fix: leave its return type inferred, so Revoke keeps only NotActive.
const requireActive = (current: Membership) =>
	current.active ? Result.succeed(current) : Result.fail(NotActive.make({}));

const wide = Decider.make({
	...membership,
	decide: {
		...membership.decide,
		Revoke: (current) => Result.map(requireActiveWide(current), () => [Revoked.make({})])
	}
});
const narrow = Decider.make({
	...membership,
	decide: {
		...membership.decide,
		Revoke: (current) => Result.map(requireActive(current), () => [Revoked.make({})])
	}
});
const revokeWide = Decider.handle(wide, Memberships)('user-4', Revoke.make({}));
const revoke = Decider.handle(narrow, Memberships)('user-4', Revoke.make({}));
expectTypeOf<Effect.Error<typeof revokeWide>>().toEqualTypeOf<Rejection>();
expectTypeOf<Effect.Error<typeof revoke>>().toEqualTypeOf<typeof NotActive.Type>();

// The same for a helper around handle: one taking Command gives every handler's
// rejections, one generic in the command keeps each call's own.
const handleMembership = Decider.handle(membership, Memberships);
const sendWide = (key: string, command: Command) =>
	handleMembership(key, command).pipe(Effect.withSpan('membership'));
const send = <C extends Command>(key: string, command: C) =>
	handleMembership(key, command).pipe(Effect.withSpan('membership'));
expectTypeOf<Effect.Error<ReturnType<typeof sendWide>>>().toEqualTypeOf<Rejection>();
const revokeSent = send('user-4', Revoke.make({}));
expectTypeOf<Effect.Error<typeof revokeSent>>().toEqualTypeOf<typeof NotActive.Type>();
```

### A broken invariant

A state that breaks an invariant is a bug in `decide` or `evolve`, so `handle` dies with the defect `Program.InvariantBroken { invariant, state }` inside the transaction, and nothing is saved. Programs and Deciders share this one defect. `state` is the state as a line, in canonical JSON. An invariant that changes the state it judges dies the same way with `Program.InvariantChanged { invariant, before, after }`. Tales catch this before it reaches `handle` ([strict-rules.md](strict-rules.md)).

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

A Store may span one row or several tables. The state is the truth; there is no event store ([ADR 0003](https://github.com/maxedapps/effect-storytime/blob/main/adrs/0003-lean-domain-library.md)).

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
| `handle(decider, Store)` | function | Gives `(key, command: C) => Effect<Handled<State, EventOf<C>>, RejectionOf<C> \| E, Store>`. |
| `Decider<State, Command, Event, Rejection, Decide>` | interface | What `make` returns. |
| `Definition<State, Command, Event, Rejection, Decide>` | interface | What `make` takes. |
| `Handlers<State, Command, Event, Rejection>` | type | The shape of `decide`: one handler per command tag. |
| `EventOf<Decide, C>`, `RejectionOf<Decide, C>` | types | The events and rejections the handler of command `C` gives. |
| `Store<Key, State, Event, E>` | interface | `load`, `save`, `transaction`. |
| `Handled<State, Event>` | interface | `{ events, state }`, what `handle` resolves with. |
