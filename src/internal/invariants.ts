/**
 * The runtime side of the invariant contract, shared by `Decider.handle` and `Loop`: a model or
 * state that breaks a named invariant is a defect, so neither runtime keeps it.
 */
import { Array as Arr, Effect, Option } from 'effect';
import { InvariantBroken } from '../Program.ts';
import type { Invariants } from '../Program.ts';

/** Dies with `InvariantBroken` for the first invariant `value` breaks. */
export const enforce =
	<A>(invariants: Invariants<A>, show: (value: A) => string) =>
	(value: A): Effect.Effect<void> =>
		Effect.suspend(() =>
			Option.match(
				Arr.findFirst(Object.entries(invariants), ([, holds]) => !holds(value)),
				{
					onNone: () => Effect.void,
					onSome: ([invariant]) =>
						Effect.die(new InvariantBroken({ invariant, state: show(value) }))
				}
			)
		);
