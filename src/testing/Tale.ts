/**
 * A tale is a story, an exploration or a decision. Records and the Vitest adapter take any tale;
 * `covers` checks that a Program's or a Decider's tales together touch every one of its cases, and
 * `breaks` that each of its invariants can fail.
 */
import { Effect, Predicate, Record, Schema } from 'effect';
import type { Decider } from '../Decider.ts';
import { Problem, role, untouched } from './internal/check.ts';
import { TypeId } from './internal/tale.ts';
import type { Tale } from './internal/tale.ts';
import type { Invariants, Program, Tagged } from '../Program.ts';
import type { StoryFailure } from './Story.ts';

export type { Reached, Tale } from './internal/tale.ts';

/** Renders any tale as its plain lines. */
export const lines = (tale: Tale): ReadonlyArray<string> => tale[TypeId]().lines;

/** Runs any tale in memory. */
export const run = (tale: Tale) => tale[TypeId]().run;

const tags = (schema: Schema.Top, label: string): ReadonlyArray<string> =>
	// Stryker disable next-line LogicalOperator: no Schema has a `cases` that is not an object
	Predicate.hasProperty(schema, 'cases') && Predicate.isObject(schema.cases)
		? Object.keys(schema.cases).map((tag) => `${label}.${tag}`)
		: [];

/**
 * Every case a Program or a Decider has, from each of its Schemas that is a tagged union: a
 * Program's Models, Messages and Commands, a Decider's States, Commands, Events and Rejections.
 */
export const cases = <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	State,
	DeciderCommand extends Tagged,
	Event,
	Rejection
>(
	subject: Program<Model, Message, Command> | Decider<State, DeciderCommand, Event, Rejection>
): ReadonlyArray<string> =>
	'decide' in subject
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
export class Uncovered extends Schema.TaggedError<Uncovered>()('Uncovered', {
	missing: Schema.Array(Schema.String)
}) {
	override get message() {
		return `no tale touches ${this.missing.join(', ')}`;
	}
}

/**
 * Runs a Program's stories and explorations, or a Decider's decisions and explorations, and
 * requires them to touch every case it has between them. Tales of another subject don't count.
 */
export const covers = Effect.fnUntraced(function* <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	State,
	DeciderCommand extends Tagged,
	Event,
	Rejection
>(
	subject: Program<Model, Message, Command> | Decider<State, DeciderCommand, Event, Rejection>,
	tales: ReadonlyArray<Tale>
): Effect.fn.Return<void, StoryFailure | Uncovered> {
	const reached = yield* Effect.all(
		tales.flatMap((tale) => {
			const told = tale[TypeId]();
			return told.subject === subject ? [told.run] : [];
		})
	);
	const touched = new Set(reached.flatMap((outcome) => outcome.cases));
	const missing = cases(subject).filter((name) => !touched.has(name));
	return yield* missing.length > 0 ? Effect.fail(new Uncovered({ missing })) : Effect.void;
});

/** A Program or a Decider as `breaks` sees it: its invariants and the Schema of what they judge. */
export type Judged<Value, Name extends string> = {
	readonly invariants: Invariants<Value, Name>;
} & (
	| { readonly Model: Schema.Codec<Value, unknown> }
	| { readonly State: Schema.Codec<Value, unknown> }
);

/** For each invariant a model or state that breaks it, keyed by the invariant's name. */
export type Breaking<Value, Name extends string> = { readonly [Invariant in Name]: Value };

/** An invariant whose given model or state does not break it alone. */
export class Unbroken extends Schema.TaggedError<Unbroken>()('Unbroken', {
	invariant: Schema.String,
	problem: Schema.String,
	actual: Schema.optional(Schema.String)
}) {
	override get message() {
		return [
			`breaking invariant ${this.invariant}: ${this.problem}`,
			...(this.actual === undefined ? [] : [`actual: ${this.actual}`])
		].join('\n');
	}
}

/**
 * Proves that each invariant of a Program or a Decider can fail: the model or state given for it
 * must be valid, survive JSON, and break that invariant and no other. An invariant that can never
 * be false passes every tale unnoticed, and one that only breaks with another adds nothing.
 */
export const breaks = Effect.fnUntraced(function* <Value, Name extends string>(
	subject: Judged<Value, Name>,
	states: Breaking<NoInfer<Value>, NoInfer<Name>>
): Effect.fn.Return<void, Unbroken> {
	const noun = 'State' in subject ? 'state' : 'model';
	const what = `the ${noun}`;
	const value = role('State' in subject ? subject.State : subject.Model, what);
	const invariants: Invariants<Value> = subject.invariants;
	const given: Readonly<Record.ReadonlyRecord<string, Value>> = states;
	const alone = Effect.fnUntraced(function* (invariant: string) {
		const state = yield* Effect.fromOption(Record.get(given, invariant)).pipe(
			Effect.mapError(() => new Problem({ message: `no ${noun} given` }))
		);
		yield* value.valid(state);
		const copy = yield* value.copy(state);
		const broken = yield* Effect.filter(Object.entries(invariants), ([name, holds]) =>
			Effect.map(
				untouched(`invariant ${name}`, value.key(copy), () => holds(copy)),
				(held) => !held
			)
		);
		const names = broken.map(([name]) => name);
		const others = names.filter((name) => name !== invariant);
		const kept = !names.includes(invariant);
		return yield* kept || others.length > 0
			? new Problem({
					message: kept ? `${what} holds it` : `${what} breaks ${others.join(', ')} too`,
					actual: value.show(copy)
				})
			: Effect.void;
	});
	yield* Effect.forEach(Object.keys(invariants), (invariant) =>
		Effect.mapError(
			alone(invariant),
			(problem) => new Unbroken({ invariant, problem: problem.message, actual: problem.actual })
		)
	);
});
