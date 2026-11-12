/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's or a Decider's tales together touch every one of its cases.
 */
import { Effect, Predicate, Schema } from 'effect';
import { TypeId } from './internal/tale.js';
/** Renders any tale as its plain lines. */
export const lines = (tale) => tale[TypeId]().lines;
/** Runs any tale in memory. */
export const run = (tale) => tale[TypeId]().run;
const tags = (schema, role) => 
// Stryker disable next-line LogicalOperator: no Schema has a `cases` that is not an object
Predicate.hasProperty(schema, 'cases') && Predicate.isObject(schema.cases)
    ? Object.keys(schema.cases).map((tag) => `${role}.${tag}`)
    : [];
/**
 * Every case a Program or a Decider has, from each of its Schemas that is a tagged union: a
 * Program's Models, Messages and Commands, a Decider's States, Commands, Events and Rejections.
 */
export const cases = (subject) => 'decide' in subject
    ? [
        ...tags(subject.State, 'State'),
        ...tags(subject.Command, 'Command'),
        ...tags(subject.Event, 'Event'),
        ...tags(subject.Rejection, 'Rejection')
    ]
    : [
        ...tags(subject.Model, 'Model'),
        ...tags(subject.Message, 'Message'),
        ...tags(subject.Command, 'Command')
    ];
/** The cases of a Program or Decider that none of its tales touched. */
export class Uncovered extends Schema.TaggedError()('Uncovered', {
    missing: Schema.Array(Schema.String)
}) {
    get message() {
        return `no tale touches ${this.missing.join(', ')}`;
    }
}
/**
 * Runs a Program's stories and explorations, or a Decider's decisions and explorations, and
 * requires them to touch every case it has between them. Tales of another subject don't count.
 */
export const covers = Effect.fnUntraced(function* (subject, tales) {
    const reached = yield* Effect.all(tales.flatMap((tale) => {
        const told = tale[TypeId]();
        return told.subject === subject ? [told.run] : [];
    }));
    const touched = new Set(reached.flatMap((outcome) => outcome.cases));
    const missing = cases(subject).filter((name) => !touched.has(name));
    return yield* missing.length > 0 ? Effect.fail(new Uncovered({ missing })) : Effect.void;
});
//# sourceMappingURL=Tale.js.map