/**
 * The runtime side of the invariant contract, shared by `Decider.handle` and `Loop`: a model or
 * state that breaks a named invariant is a defect, so neither runtime keeps it.
 */
import { Effect } from 'effect';
import type { Invariants } from '../Program.ts';
/** Dies with `InvariantBroken` for the first invariant `value` breaks. */
export declare const enforce: <A>(invariants: Invariants<A>, show: (value: A) => string) => (value: A) => Effect.Effect<void>;
//# sourceMappingURL=invariants.d.ts.map