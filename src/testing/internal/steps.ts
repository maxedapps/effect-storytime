/**
 * Steps as data: what every tale says, step by step, as a verb and the values it names. Records
 * keep it, lines and Markdown render it, and a counterexample prints it as code.
 */
import { Schema } from 'effect';
import type { Types } from 'effect';
import { text } from '../../internal/canonical.ts';

/**
 * A value a step names: its `_tag`, its canonical JSON without the tag (absent for a tag alone),
 * or why it has no JSON.
 */
export const Value = Schema.Struct({
	tag: Schema.optionalKey(Schema.String),
	value: Schema.optionalKey(Schema.Json),
	notJson: Schema.optionalKey(Schema.String)
});

export type Value = typeof Value.Type;

export const Verb = Schema.Literals([
	'given',
	'send',
	'model',
	'satisfies',
	'commands',
	'resolve',
	'emit',
	'restart',
	'any order',
	'when',
	'accepted',
	'rejected',
	'state',
	'explore'
]);

export type Verb = typeof Verb.Type;

/**
 * One step: its verb, how deep it sits in `any order`s (absent at the top), a `satisfies` label or
 * an exploration's settings, and its values in the order its builder takes them.
 */
export const Step = Schema.Struct({
	verb: Verb,
	depth: Schema.optionalKey(Schema.Int),
	label: Schema.optionalKey(Schema.String),
	values: Schema.Array(Value)
});

export type Step = typeof Step.Type;

/** The verbs whose values are a list, `none` when empty. */
const lists: ReadonlySet<Verb> = new Set(['commands', 'accepted']);
/** The verbs whose second value is what the first gave. */
const arrows: ReadonlySet<Verb> = new Set(['resolve', 'emit']);

/** Whether a step's second value is what its first gave, shown after an arrow. */
export const arrowed = (verb: Verb) => arrows.has(verb);

/** What joins a step's values. */
const joiner = (verb: Verb) => (arrowed(verb) ? ' → ' : ', ');

/**
 * A step's values, each shown by `show`, joined as one: `none` for an empty list, nothing for a
 * step without values.
 */
export const shown = (
	{ verb, values }: Step,
	show: (value: Value) => string
): ReadonlyArray<string> => {
	if (values.length > 0) return [values.map(show).join(joiner(verb))];
	return lists.has(verb) ? ['none'] : [];
};

/** A step as one line, indented two spaces per `any order` around it. */
export const line = (step: Step): string =>
	`${'  '.repeat(step.depth ?? 0)}${[
		step.verb,
		...(step.label === undefined ? [] : [step.label]),
		...shown(step, text)
	].join(' ')}`;

/** A step from its verb, depth and values, and a label where it has one. */
export const say = (
	verb: Verb,
	depth: number,
	values: ReadonlyArray<Value>,
	label?: string
): Step => {
	const data: Types.Mutable<Step> = { verb, values };
	if (depth > 0) data.depth = depth;
	if (label !== undefined) data.label = label;
	return data;
};
