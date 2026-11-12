/**
 * The runtime side of the invariant contract, shared by `Decider.handle` and `Loop`: a model or
 * state that breaks a named invariant is a defect, and so is an invariant that changes it, so
 * neither runtime keeps it.
 */
import { Effect } from 'effect';
import type { Schema } from 'effect';
import type { Invariants } from '../Program.ts';
/**
 * Dies with `InvariantChanged` for the first invariant that changes the canonical JSON of `value`,
 * leaving it unencodable included, or `InvariantBroken` for the first one it breaks.
 */
export declare const enforce: <A>(invariants: Invariants<A>, schema: Schema.Codec<A, unknown>) => (value: A) => Effect.Effect<void>;
//# sourceMappingURL=invariants.d.ts.map