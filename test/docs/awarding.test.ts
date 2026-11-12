// The badge awarding process as docs/recipes.md shows it: a process manager that drives a Decider
// and survives a crash.
import { describe, expect, layer } from '@effect/vitest';
import { Effect, Option, Ref, Stream } from 'effect';
import { Decider, Loop } from 'effect-storytime';
import { Decision, Story, Vitest } from 'effect-storytime/testing';
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
const first = Award.make({ learner: 'ada', badge: 'first-lecture' });

const reissues = Story.make(
	'a restart reissues every award still pending',
	awarding,
	Story.given({ pending: [] }),
	Story.send(LecturesCompleted.make({ learner: 'ada', total: 1 })),
	Story.commands(first),
	Story.restart(),
	Story.commands(first),
	Story.resolve(first, Awarded.make({ learner: 'ada', badge: 'first-lecture' })),
	Story.model({ pending: [] })
);

const once = Decision.make(
	'a badge is earned once',
	badges,
	Decision.given(badges.initial),
	Decision.when(first),
	Decision.accepted(BadgeEarned.make({ badge: 'first-lecture' })),
	Decision.when(first),
	Decision.rejected(AlreadyEarned.make({ badge: 'first-lecture' }))
);
// #endregion tales

describe('awarding', () => {
	Vitest.stories(reissues, once);
	Vitest.covers(awarding, [reissues]);
});

layer(Badges.layer)('awarding in a Loop', (it) => {
	it.effect('recovers an award a crash interrupted', () =>
		Effect.gen(function* () {
			// #region loop
			const stored = yield* Ref.make(Option.none<Awarding>());
			const persist = {
				load: Ref.get(stored),
				save: (model: Awarding) => Ref.set(stored, Option.some(model))
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
						persist
					});
					yield* crashing.dispatch(LecturesCompleted.make({ learner: 'ada', total: 1 }));
				})
			);

			// The next process resumes the stored model, and `resume` sends the award again.
			const loop = yield* Loop.make(awarding, {
				init: { model: { pending: [] } },
				handler,
				persist
			});
			yield* loop.changes.pipe(
				Stream.filter(({ pending }) => pending.length === 0),
				Stream.runHead
			);
			// #endregion loop
			const store = yield* Badges;
			expect(yield* store.load('ada')).toEqual(Option.some({ badges: ['first-lecture'] }));
		})
	);
});
