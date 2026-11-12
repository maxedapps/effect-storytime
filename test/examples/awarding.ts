// A process manager shaped like infinite's badge awards: completed lectures earn badges, a badges
// Decider awards each once, and a restart reissues every award still pending.
import { Context, Effect, Layer, Option, Ref, Result, Schema, Semaphore } from 'effect';
import { Decider, Program } from 'effect-storytime';

// #region badges
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
// #endregion badges

// #region awarding
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
// #endregion awarding

// #region store
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
// #endregion store
