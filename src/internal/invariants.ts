/**
 * The runtime side of the invariant contract, shared by `Decider.handle` and `Loop`: a model or
 * state that breaks a named invariant is a defect, and so is an invariant that changes it, so
 * neither runtime keeps it.
 */
import { Effect, Result } from 'effect';
import type { Schema } from 'effect';
import { InvariantBroken, InvariantChanged } from '../Program.ts';
import type { Invariants } from '../Program.ts';
import { canonical, describer, notJson } from './canonical.ts';

/**
 * Dies with `InvariantChanged` for the first invariant that changes the canonical JSON of `value`,
 * leaving it unencodable included, or `InvariantBroken` for the first one it breaks.
 */
export const enforce = <A>(invariants: Invariants<A>, schema: Schema.Codec<A, unknown>) => {
	const encode = canonical(schema);
	const key = (value: A) => Result.getOrElse(encode(value), notJson);
	const show = describer(schema);
	return (value: A): Effect.Effect<void> =>
		Effect.suspend(() => {
			for (const [invariant, holds] of Object.entries(invariants)) {
				const before = key(value);
				const held = holds(value);
				const after = key(value);
				if (after !== before) return Effect.die(new InvariantChanged({ invariant, before, after }));
				if (!held) return Effect.die(new InvariantBroken({ invariant, state: show(value) }));
			}
			return Effect.void;
		});
};
