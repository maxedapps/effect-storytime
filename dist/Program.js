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
const unchanged = (model) => ({ model });
export const make = (definition) => ({
    ...definition,
    resume: definition.resume ?? unchanged,
    invariants: definition.invariants ?? {}
});
//# sourceMappingURL=Program.js.map