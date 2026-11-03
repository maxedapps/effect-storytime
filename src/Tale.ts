/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's tales together touch every one of its cases.
 */
import { Effect, Match, Predicate, Schema } from 'effect';
import * as Exploration from './Exploration.ts';
import { TypeId } from './internal/tale.ts';
import type { Tale } from './internal/tale.ts';
import type { Program, Tagged } from './Program.ts';
import * as Story from './Story.ts';

export type { Reached, Tale } from './internal/tale.ts';

/** Renders any tale as its plain lines. */
export const lines = (tale: Tale): ReadonlyArray<string> => tale[TypeId]().lines;

/** Runs any tale in memory. */
export const run = (tale: Tale) => tale[TypeId]().run;

/** Every case a Program has: its Messages, its Commands and, for a tagged union, its Models. */
export const cases = <Model, Message extends Tagged, Command extends Tagged>(
	program: Program<Model, Message, Command>
): ReadonlyArray<string> => [
	// Stryker disable next-line LogicalOperator: no Schema has a `cases` that is not an object
	...(Predicate.hasProperty(program.Model, 'cases') && Predicate.isObject(program.Model.cases)
		? Object.keys(program.Model.cases).map((tag) => `Model.${tag}`)
		: []),
	...Object.keys(program.Message.cases).map((tag) => `Message.${tag}`),
	...Object.keys(program.Command.cases).map((tag) => `Command.${tag}`)
];

/** The cases of a Program that none of its tales touched. */
export class Uncovered extends Schema.TaggedError<Uncovered>()('Uncovered', {
	missing: Schema.Array(Schema.String)
}) {
	override get message() {
		return `no tale touches ${this.missing.join(', ')}`;
	}
}

/**
 * Runs a Program's stories and explorations and requires them to send, produce or reach every
 * case it has between them.
 */
export const covers = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged
>(
	program: Program<Model, Message, Command>,
	tales: ReadonlyArray<
		Story.Story<Model, Message, Command> | Exploration.Exploration<Model, Message, Command>
	>
): Effect.fn.Return<void, Story.StoryFailure | Uncovered> {
	const reached = yield* Effect.forEach(tales, (tale) =>
		Match.valueTags(tale, {
			Story: (story) => Story.run(story),
			Exploration: (exploration) => Exploration.check(exploration)
		})
	);
	const touched = new Set(reached.flatMap((outcome) => outcome.cases));
	const missing = cases(program).filter((name) => !touched.has(name));
	return yield* missing.length > 0 ? Effect.fail(new Uncovered({ missing })) : Effect.void;
});
