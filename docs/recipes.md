# Recipes

## A process manager that survives a crash

A process manager is a Program whose commands drive Deciders. This one awards badges: a learner who completes lectures earns milestone badges, a badges Decider records each badge once, and a crash between the two loses nothing. The full code is in `test/examples/awarding.ts` and `test/docs/awarding.test.ts`.

### The Decider makes the command idempotent

The process may send the same `Award` twice after a crash, so the badges Decider rejects a badge it has seen. The rejection is what makes a resent command safe.

<!-- snippet: test/examples/awarding.ts#badges -->
```ts
export const Earned = Schema.Struct({ badges: Schema.Array(Schema.String) });
export type Earned = typeof Earned.Type;

export const Command = Schema.TaggedUnion({
	Award: { learner: Schema.String, badge: Schema.String }
});
export const Event = Schema.TaggedUnion({ BadgeEarned: { badge: Schema.String } });
export type Event = typeof Event.Type;
export const Rejection = Schema.TaggedUnion({ AlreadyEarned: { badge: Schema.String } });

export const { Award } = Command.cases;
export const { BadgeEarned } = Event.cases;
export const { AlreadyEarned } = Rejection.cases;

// Keyed by learner. Awarding a badge twice is rejected, so an Award command is idempotent.
export const badges = Decider.make({
	State: Earned,
	Command,
	Event,
	Rejection,
	initial: { badges: [] },
	decide: (earned, { badge }) =>
		earned.badges.includes(badge)
			? Result.fail(AlreadyEarned.make({ badge }))
			: Result.succeed([BadgeEarned.make({ badge })]),
	evolve: (earned, { badge }) => ({ badges: [...earned.badges, badge] })
});
```

### The model remembers what is under way

The Program keeps every award it sent until the `Awarded` message for it comes back, and `resume` sends every pending one again:

<!-- snippet: test/examples/awarding.ts#awarding -->
```ts
export const Awarding = Schema.Struct({ pending: Schema.Array(Award) });
export type Awarding = typeof Awarding.Type;

export const Message = Schema.TaggedUnion({
	LecturesCompleted: { learner: Schema.String, total: Schema.Int },
	Awarded: { learner: Schema.String, badge: Schema.String }
});

const milestones = [
	{ badge: 'first-lecture', at: 1 },
	{ badge: 'ten-lectures', at: 10 }
];

export const awarding = Program.make({
	Model: Awarding,
	Message,
	Command,
	update: (model, message) =>
		Message.match(message, {
			LecturesCompleted: ({ learner, total }) => {
				const awards = milestones.flatMap(({ badge, at }) =>
					at === total ? [Award.make({ learner, badge })] : []
				);
				return { model: { pending: [...model.pending, ...awards] }, commands: awards };
			},
			Awarded: ({ learner, badge }) => ({
				model: {
					pending: model.pending.filter(
						(award) => award.learner !== learner || award.badge !== badge
					)
				}
			})
		}),
	// The model remembers every award under way, so a restart sends them again.
	resume: (model) => ({ model, commands: model.pending })
});
```

### The tales

A story checks the restart, and a decision checks that a badge is earned once:

<!-- snippet: test/docs/awarding.test.ts#tales -->
```ts
const story = Story.of(awarding);
const decision = Decision.of(badges);
const first = Award.make({ learner: 'ada', badge: 'first-lecture' });

const reissues = Story.make(
	'a restart reissues every award still pending',
	awarding,
	story.given({ pending: [] }),
	story.send(LecturesCompleted.make({ learner: 'ada', total: 1 })),
	story.commands(first),
	story.restart(),
	story.commands(first),
	story.resolve(first, Awarded.make({ learner: 'ada', badge: 'first-lecture' })),
	story.model({ pending: [] })
);

const once = Decision.make(
	'a badge is earned once',
	badges,
	decision.given(badges.initial),
	decision.when(first),
	decision.accepted(BadgeEarned.make({ badge: 'first-lecture' })),
	decision.when(first),
	decision.rejected(AlreadyEarned.make({ badge: 'first-lecture' }))
);
```

### Running it

The handler calls `Decider.handle` for each `Award`. `AlreadyEarned` means an earlier run already awarded the badge, perhaps one a crash cut short, so the handler treats it as done. With a `store`, the Loop saves the model before it starts the award, so the next process finds the award pending, sends it again, and `Loop.run` returns once it is done:

<!-- snippet: test/docs/awarding.test.ts#loop -->
```ts
const stored = yield* Ref.make(Option.none<Awarding>());
const store: Loop.Store<Awarding, never, never> = {
	load: Ref.get(stored),
	save: (model) => Ref.set(stored, Option.some(model)),
	transaction: (effect) => effect
};
const award = Decider.handle(badges, Badges);
const handler = Command.match({
	Award: ({ learner, badge }) =>
		award(learner, Award.make({ learner, badge })).pipe(
			// Earned before, maybe by a run a crash cut short: the award is done either way.
			Effect.catchTag('AlreadyEarned', () => Effect.void),
			Effect.as(Awarded.make({ learner, badge }))
		)
});

// A process that crashes while the award runs: its scope closes and interrupts it.
yield* Effect.scoped(
	Effect.gen(function* () {
		const crashing = yield* Loop.make(awarding, {
			init: { model: { pending: [] } },
			handler: () => Effect.never,
			store
		});
		yield* crashing.dispatch(LecturesCompleted.make({ learner: 'ada', total: 1 }));
	})
);

// The next process resumes the stored model, `resume` sends the award again, and the run
// ends once it is done.
const recovered = yield* Loop.run(awarding, {
	init: { model: { pending: [] } },
	handler,
	store
});
```

The gap this doesn't close is a message that never reached the Loop ([domain-modelling.md](domain-modelling.md#state-is-the-truth)).

## Testing a database Store

Write the Store as a `Context.Service` with a layer on your database ([decider.md](decider.md#a-store-on-effectsql)). Then run your in-memory decisions against it with `Decision.against` inside `layer(Store.layer)`, after the test arranges the rows the decision's `given` expects ([decisions.md](decisions.md#against-a-real-store)). The same decision then checks the rules and the persistence.

## Fixing an exploration's counterexample

1. Read `failure.counterexample` and `failure.step` from the test output or the story record.
2. Copy the lines into a `Story.make` or `Decision.make`, building each value with its union's `make`. The new tale fails the same way.
3. Fix the subject until the tale passes, then keep the tale.
4. `Exploration.check(exploration, { replay: failure.replay })` checks just the original path again.

## Laying out a domain in an app

One way that keeps the entries apart:

```text
src/domain/membership.ts          Schemas, decide, evolve, the Decider (imports effect-storytime)
src/domain/chat.ts                Schemas, update, the Program
src/server/memberships.ts         the Store service and its layer on the database
src/server/chat-loop.ts           Loop.make with the handler and the store
test/domain/membership.test.ts    decisions, an exploration, Vitest.stories and Vitest.covers
test/server/memberships.test.ts   the same decisions through Decision.against
vitest.config.ts                  Vitest.Reporter
```

Only test files import `effect-storytime/testing` and `effect-storytime/vitest`, and only `vitest.config.ts` imports the reporter.
