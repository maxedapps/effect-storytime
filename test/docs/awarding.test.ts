// The badge awarding process as docs/recipes.md shows it: a process manager that drives a Decider
// and survives a crash.
import { describe, expect, layer } from '@effect/vitest';
import { Deferred, Effect, Option, Ref } from 'effect';
import { Decider, Loop } from 'effect-storytime';
import { Decision, Story } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import {
	AlreadyEarned,
	Award,
	awarding,
	Badges,
	badges,
	BadgeEarned,
	Command,
	Message
} from '../examples/awarding.ts';
import type { Awarding } from '../examples/awarding.ts';

const { LecturesCompleted, Awarded } = Message.cases;

// #region tales
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
// #endregion tales

describe('awarding', () => {
	Vitest.stories(reissues, once);
	Vitest.covers(awarding, [reissues]);
});

// #region handler
// The production handler: each award goes through the badges Decider on its Store.
const award = Decider.handle(badges, Badges);
const handler = Command.match({
	Award: ({ learner, badge }) =>
		award(learner, Award.make({ learner, badge })).pipe(
			// Earned before, maybe by a run a crash cut short: the award is done either way.
			Effect.catchTag('AlreadyEarned', () => Effect.void),
			Effect.as(Awarded.make({ learner, badge }))
		)
});
// #endregion handler

layer(Badges.layer)('awarding in a Loop', (it) => {
	it.effect('awards a badge end to end', () =>
		Effect.gen(function* () {
			// #region run
			// The message goes in, the award runs through `Decider.handle`, its reply settles the model.
			const model = yield* Loop.run(awarding, {
				init: { model: { pending: [] } },
				handler,
				messages: [LecturesCompleted.make({ learner: 'ada', total: 1 })]
			});
			expect(model).toEqual({ pending: [] });
			const earned = yield* Badges;
			expect(yield* earned.load('ada')).toEqual(Option.some({ badges: ['first-lecture'] }));
			// #endregion run
		})
	);

	it.effect('recovers an award whose reply a crash lost', () =>
		Effect.gen(function* () {
			// #region crash
			const stored = yield* Ref.make(Option.none<Awarding>());
			const store: Loop.Store<Awarding, never, never> = {
				load: Ref.get(stored),
				save: (model) => Ref.set(stored, Option.some(model)),
				transaction: (effect) => effect
			};

			// A process that crashes mid-command: the Decider committed the award, then the scope
			// closes before the reply reaches the Loop.
			const committed = yield* Deferred.make<void>();
			yield* Effect.scoped(
				Effect.gen(function* () {
					const crashing = yield* Loop.make(awarding, {
						init: { model: { pending: [] } },
						handler: (command) =>
							handler(command).pipe(
								Effect.andThen(Deferred.succeed(committed, undefined)),
								Effect.andThen(Effect.never)
							),
						store
					});
					yield* crashing.dispatch(LecturesCompleted.make({ learner: 'bo', total: 1 }));
					yield* Deferred.await(committed);
				})
			);
			expect(yield* Ref.get(stored)).toEqual(
				Option.some({ pending: [Award.make({ learner: 'bo', badge: 'first-lecture' })] })
			);

			// The next process resumes the stored model and `resume` reissues the award. The Decider
			// rejects the duplicate, the handler takes `AlreadyEarned` as done, and the run ends.
			const recovered = yield* Loop.run(awarding, {
				init: { model: { pending: [] } },
				handler,
				store
			});
			expect(recovered).toEqual({ pending: [] });
			// Earned once: the reissued award was rejected, not applied again.
			const earned = yield* Badges;
			expect(yield* earned.load('bo')).toEqual(Option.some({ badges: ['first-lecture'] }));
			// #endregion crash
		})
	);
});
