# Decisions

`import { Decision } from 'effect-storytime/testing'`

A decision tells how a Decider rules. It starts from a state, sends commands, and names the events or the rejection each one gives. `Decision.run` checks it in memory, and `Decision.against` runs the same steps through `Decider.handle` on a real Store. Both run the strict rules ([strict-rules.md](strict-rules.md)).

## Writing a decision

`Decision.make(title, decider, ...steps)` infers the types from the Decider. The examples use the membership Decider from [decider.md](decider.md).

<!-- snippet: test/docs/membership.test.ts#lifecycle -->
```ts
const lifecycle = Decision.make(
	'a membership is granted once and revoked once',
	membership,
	Decision.given(membership.initial),
	Decision.when(Grant.make({ source: 'teachable', at })),
	Decision.accepted(Granted.make({ source: 'teachable', at })),
	Decision.when(Grant.make({ source: 'teachable', at: later })),
	Decision.rejected(AlreadyActive.make({ since: at })),
	Decision.when(Revoke.make({})),
	Decision.accepted(Revoked.make({})),
	Decision.state({ source: 'teachable', active: false, checkedAt: at })
);
```

| Step | Meaning |
| --- | --- |
| `given(state)` | Starts the decision from a state. It comes first and only once. |
| `when(command)` | Decides a command. The next step must be `accepted` or `rejected`. |
| `accepted(...events)` | Requires the command to give exactly these events, in this order. `accepted()` means none. |
| `rejected(rejection)` | Requires the command to be rejected with this rejection. |
| `state(expected)` | Requires the state to equal `expected` by canonical JSON. |
| `satisfies(label, check)` | Requires the state to pass `check`. Lines show the label. |

An accepted command with no events leaves the state as it was. Check what a command did with `state` or `satisfies`:

<!-- snippet: test/docs/membership.test.ts#checks -->
```ts
const checks = Decision.make(
	'a check changes only what it finds changed',
	membership,
	Decision.given({ source: 'teachable', active: true, checkedAt: at }),
	// No change, no events: the decision is accepted with none.
	Decision.when(Check.make({ active: true, at: later })),
	Decision.accepted(),
	Decision.satisfies('still active', (state) => state.active),
	Decision.when(Check.make({ active: false, at: later })),
	Decision.accepted(Checked.make({ active: false, at: later })),
	Decision.state({ source: 'teachable', active: false, checkedAt: later })
);

const manual = Decision.make(
	'a manual membership is never checked',
	membership,
	Decision.given({ source: 'manual', active: true, checkedAt: at }),
	Decision.when(Check.make({ active: false, at: later })),
	Decision.rejected(Manual.make({}))
);
```

`Decision.lines(decision)` renders it as lines: `given …`, `when …`, `accepted none` or `accepted <event>, <event>`, `rejected …`, `state …` and `satisfies <label>`.

## Running a decision

`Decision.run(decision)` gives `Effect<Decision.Outcome<State>, StoryFailure>`. The outcome is the final state, the same state as a line, and the cases the decision touched: its commands, events, rejections and every state a command's events pass through. Failures have the same shape as a story's ([stories.md](stories.md#failures)).

## Against a real Store

`Decision.against(decision, Store, key)` runs the decision through `handle`'s transaction on the Store service, under `key`:

- It doesn't seed anything. The test arranges the Store's rows first. `given` loads the state under `key` (or `initial`, when there is none) and fails unless it equals the given state.
- Each `when` decides and saves in its own transaction, as `handle` does in production.
- `state` and `satisfies` check what the Store loads back, so a column the Store forgets to save fails the decision.
- Store errors fail the Effect as they are, so the error type is `StoryFailure | E`.

Run it inside `layer(Store.layer)` and record it with `Vitest.tell` ([vitest.md](vitest.md)):

<!-- snippet: test/docs/membership.test.ts#vitest -->
```ts
describe('membership', () => {
	Vitest.stories(lifecycle, checks, manual, holds);
	Vitest.covers(membership, [lifecycle, checks, manual, holds]);
});

// The same decision through `handle`'s transaction on a Store. Here the Store keeps rows in
// memory; an app passes its database layer.
layer(Memberships.layer)('membership in its Store', (it) => {
	it.effect('a membership is granted once and revoked once', (ctx) =>
		Vitest.tell(ctx, lifecycle, Decision.against(lifecycle, Memberships, 'user-1'))
	);
});
```

Use a fresh key per test when tests share a layer, or give each test its own layer: a key that an earlier test already saved under no longer loads `initial`.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `make(title, decider, ...steps)` | function | Builds a `Decision`. |
| `given`, `when`, `accepted`, `rejected`, `state`, `satisfies` | functions | The steps above, each a `Decision.Step`. |
| `run(decision)` | `Effect<Outcome<State>, StoryFailure>` | Checks a decision in memory. |
| `against(decision, Store, key)` | `Effect<Outcome<State>, StoryFailure \| E, Store>` | Runs it through `handle` on a real Store. |
| `lines(decision)` | `ReadonlyArray<string>` | The decision as lines. |
| `Decision<State, Command, Event, Rejection>` | class | A decision value: `title`, `decider`, `steps`. |
| `Step<State, Command, Event, Rejection>` | type | One step. |
| `Outcome<State>` | interface | `{ state, final, cases }`. |
