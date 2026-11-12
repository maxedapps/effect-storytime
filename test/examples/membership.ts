// A membership row shaped like infinite's: its state stores `active` as a bit, and a Store service
// keeps rows encoded in memory and logs every call, so tests see what `handle` did.
import { Context, Effect, Layer, Option, Ref, Result, Schema } from 'effect';
import { Decider } from 'effect-storytime';

// #region schemas
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
// #endregion schemas

// #region decider
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
// #endregion decider

/** The membership with some handlers replaced, keeping the rest. */
export const variant = (
	handlers: Partial<Decider.Handlers<Membership, Command, Event, Rejection>>
) => Decider.make({ ...membership, decide: { ...membership.decide, ...handlers } });

export const at = '2026-11-03T00:00:00.000Z';
export const later = '2026-11-04T00:00:00.000Z';

export interface Recorded extends Decider.Store<string, Membership, Event> {
	readonly log: Effect.Effect<ReadonlyArray<string>>;
}

export class Memberships extends Context.Service<Memberships, Recorded>()('test/Memberships') {
	static readonly layer = Layer.effect(
		Memberships,
		Effect.gen(function* () {
			const rows = yield* Ref.make(new Map<string, typeof Membership.Encoded>());
			const log = yield* Ref.make<ReadonlyArray<string>>([]);
			const write = (entry: string) => Ref.update(log, (entries) => [...entries, entry]);
			return Memberships.of({
				load: (key) =>
					Effect.andThen(write(`load ${key}`), Ref.get(rows)).pipe(
						Effect.map((all) =>
							Option.map(Option.fromUndefinedOr(all.get(key)), Schema.decodeSync(Membership))
						)
					),
				save: (key, state, events) =>
					Effect.andThen(
						write(['save', key, ...events.map((event) => event._tag)].join(' ')),
						Ref.update(rows, (all) => new Map(all).set(key, Schema.encodeSync(Membership)(state)))
					),
				transaction: (effect) =>
					write('begin').pipe(
						Effect.andThen(effect),
						Effect.tap(() => write('commit'))
					),
				log: Ref.get(log)
			});
		})
	);
}
