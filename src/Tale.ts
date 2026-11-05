/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's or a Decider's tales together touch every one of its cases.
 */
import { Effect, Predicate, Schema } from 'effect';
import type { Decider } from './Decider.ts';
import { TypeId } from './internal/tale.ts';
import type { Tale } from './internal/tale.ts';
import type { Program, Tagged } from './Program.ts';
import type { StoryFailure } from './Story.ts';

export type { Reached, Tale } from './internal/tale.ts';

/** Renders any tale as its plain lines. */
export const lines = (tale: Tale): ReadonlyArray<string> => tale[TypeId]().lines;

/** Runs any tale in memory. */
export const run = (tale: Tale) => tale[TypeId]().run;

const tags = (schema: Schema.Top, role: string): ReadonlyArray<string> =>
	// Stryker disable next-line LogicalOperator: no Schema has a `cases` that is not an object
	Predicate.hasProperty(schema, 'cases') && Predicate.isObject(schema.cases)
		? Object.keys(schema.cases).map((tag) => `${role}.${tag}`)
		: [];

/**
 * Every case a Program or a Decider has, from each of its Schemas that is a tagged union: a
 * Program's Models, Messages and Commands, a Decider's States, Inputs, Events and Rejections.
 */
export const cases = <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	State,
	Input,
	Event,
	Rejection
>(
	subject: Program<Model, Message, Command> | Decider<State, Input, Event, Rejection>
): ReadonlyArray<string> =>
	'decide' in subject
		? [
				...tags(subject.State, 'State'),
				...tags(subject.Input, 'Input'),
				...tags(subject.Event, 'Event'),
				...tags(subject.Rejection, 'Rejection')
			]
		: [
				...tags(subject.Model, 'Model'),
				...tags(subject.Message, 'Message'),
				...tags(subject.Command, 'Command')
			];

/** The cases of a Program or Decider that none of its tales touched. */
export class Uncovered extends Schema.TaggedError<Uncovered>()('Uncovered', {
	missing: Schema.Array(Schema.String)
}) {
	override get message() {
		return `no tale touches ${this.missing.join(', ')}`;
	}
}

/**
 * Runs a Program's stories and explorations, or a Decider's decisions and explorations, and
 * requires them to touch every case it has between them.
 */
export const covers = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	State,
	Input,
	Event,
	Rejection
>(
	subject: Program<Model, Message, Command> | Decider<State, Input, Event, Rejection>,
	tales: ReadonlyArray<Tale>
): Effect.fn.Return<void, StoryFailure | Uncovered> {
	const reached = yield* Effect.forEach(tales, run);
	const touched = new Set(reached.flatMap((outcome) => outcome.cases));
	const missing = cases(subject).filter((name) => !touched.has(name));
	return yield* missing.length > 0 ? Effect.fail(new Uncovered({ missing })) : Effect.void;
});
