/**
 * A Program is a pure state machine: `update` turns a model and a message into the next model
 * and the commands to run. Commands are Schema data; a Loop runs them, a story asserts them.
 */
import { Schema } from 'effect';
/**
 * The defect a Loop or `Decider.handle` dies with when a model or state breaks an invariant. It
 * dies before anything is saved, published or started.
 */
export class InvariantBroken extends Schema.TaggedError()('InvariantBroken', {
    invariant: Schema.String,
    /** The model or state as a line, as stories show it. */
    state: Schema.String
}) {
    get message() {
        return `invariant ${this.invariant} does not hold for ${this.state}`;
    }
}
/**
 * The defect a Loop or `Decider.handle` dies with when an invariant changes the model or state it
 * checks, which must leave it alone. It dies before anything is saved, published or started.
 */
export class InvariantChanged extends Schema.TaggedError()('InvariantChanged', {
    invariant: Schema.String,
    /** The model or state's canonical JSON before and after the invariant ran. */
    before: Schema.String,
    after: Schema.String
}) {
    get message() {
        return `invariant ${this.invariant} changed ${this.before} to ${this.after}`;
    }
}
const unchanged = (model) => ({ model });
export const make = (definition) => ({
    ...definition,
    resume: definition.resume ?? unchanged,
    // SAFETY: `Name` is inferred from the invariants given; without any it keeps its default,
    // `string`, which the empty record satisfies.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TypeScript can't tie a missing property to `Name`
    invariants: definition.invariants ?? {}
});
//# sourceMappingURL=Program.js.map