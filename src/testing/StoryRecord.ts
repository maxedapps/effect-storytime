/**
 * The story record: every tale a test run told, as deterministic JSON with its steps as data. The
 * reporter writes a `StoryReport`; tools read it back with `decode`, and `markdown` renders it
 * as a page to review.
 */
import { Array as Arr, Predicate, Schema, Struct } from 'effect';
import { arrowed, line, shown, Step, Value } from './internal/steps.ts';
import { StoryFailure } from './Story.ts';

/** A step as the one line messages and `Tale.lines` show, such as `send Asked {"turn":"t1"}`. */
export { line, Step, Value };

/** Where and why a tale failed; for an exploration, also its counterexample and replay token. */
export const Failure = Schema.Struct(Struct.omit(StoryFailure.fields, ['_tag', 'title']));

export type Failure = typeof Failure.Type;

/**
 * Where a passing story ended in one order of its `anyOrder`s: its final model. The order names the
 * step numbers of their steps as they ran, and is empty without an `anyOrder`.
 */
export const Final = Schema.Struct({
	order: Schema.Array(Schema.Int),
	final: Value
});

export type Final = typeof Final.Type;

export const StoryRecord = Schema.Struct({
	kind: Schema.Literals(['Story', 'Exploration', 'Decision']),
	title: Schema.String,
	/** The test file, posix and relative to the Vitest root. */
	file: Schema.String,
	/** The test's full name, its suites joined by ` > `. */
	test: Schema.String,
	steps: Schema.Array(Step),
	status: Schema.Literals(['passed', 'failed']),
	/** The final state, once a decision passed. */
	final: Schema.optional(Value),
	/** Where a passing story ended, one entry per order. */
	finals: Schema.optional(Schema.Array(Final)),
	/** Present when the tale failed with a `StoryFailure`; another error leaves only the status. */
	failure: Schema.optional(Failure),
	/** The cases a passing story or exploration sent, produced or reached. */
	cases: Schema.optional(Schema.Array(Schema.String))
});

export type StoryRecord = typeof StoryRecord.Type;

/** A run's records, sorted by file and then test, with no timings or absolute paths. */
export const StoryReport = Schema.Struct({
	version: Schema.Literal(4),
	stories: Schema.Array(StoryRecord)
});

export type StoryReport = typeof StoryReport.Type;

/** Reads a report from the JSON text the reporter wrote. */
export const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(StoryReport));

/** Backticks enough to fence `text`: one more than its longest run, and at least `least`. */
const ticks = (text: string, least: number) =>
	'`'.repeat(Math.max(least, ...Array.from(text.matchAll(/`+/g), ([run]) => run.length + 1)));

/** `text` as inline code. */
const code = (text: string) => {
	const fence = ticks(text, 1);
	const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
	return `${fence}${padded}${fence}`;
};

/** `text` as a fenced block in `language`. */
const block = (text: string, language: string): ReadonlyArray<string> => {
	const fence = ticks(text, 3);
	return [`${fence}${language}`, ...text.split('\n'), fence];
};

/** JSON to read: an object's fields as `key: value`, anything else as it is. */
const readable = (json: Schema.Json) =>
	Predicate.isObject(json) && Object.keys(json).length > 0
		? Object.entries(json)
				.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
				.join(', ')
		: JSON.stringify(json);

/** A value on one line: its tag, then its fields as code. */
const inline = ({ tag, value, notJson }: Value): string =>
	notJson === undefined
		? [
				...(tag === undefined ? [] : [tag]),
				...(value === undefined ? [] : [code(readable(value))])
			].join(' ')
		: code(`not JSON: ${notJson}`);

/** A value over lines: its tag, then its JSON as a block. */
const spread = ({ tag, value, notJson }: Value): ReadonlyArray<string> =>
	notJson === undefined
		? [
				...(tag === undefined ? [] : [tag]),
				...(value === undefined ? [] : block(JSON.stringify(value, null, 2), 'json'))
			]
		: [code(`not JSON: ${notJson}`)];

/** Past this many characters, a step shows its values over lines. */
const wide = 100;

/**
 * `head` followed by `short` on one line while it fits; else `long`, one line after another under
 * it, indented by `indent`.
 */
const told = (
	indent: string,
	head: string,
	short: ReadonlyArray<string>,
	long: ReadonlyArray<string>
): ReadonlyArray<string> => {
	const joined = [head, ...short].join(' ');
	return joined.length <= wide
		? [`${indent}${joined}`]
		: [`${indent}${head}`, ...long.map((each) => `${indent}  ${each}`)];
};

/** Steps as a list, numbered from 1 and nested by depth, with `failed` marking the failing one. */
const list = (steps: ReadonlyArray<Step>, failed?: number): ReadonlyArray<string> =>
	steps.flatMap((step, index) =>
		told(
			'  '.repeat(step.depth ?? 0),
			[
				`- ${index + 1}${index + 1 === failed ? ' ✗' : ''}`,
				`**${step.verb}**`,
				...(step.label === undefined ? [] : [step.label])
			].join(' '),
			shown(step, inline),
			step.values.flatMap((value, at) =>
				at > 0 && arrowed(step.verb) ? ['→', ...spread(value)] : spread(value)
			)
		)
	);

/** Where a tale ended: a final model or state. */
const ends = (head: string, final: Value) =>
	told('', `**${head}**`, [inline(final)], spread(final)).join('\n');

/** Why a tale failed, below its steps, marked at the failing one unless a counterexample has it. */
const failed = (failure: Failure, steps: ReadonlyArray<Step>): ReadonlyArray<string> => {
	const { counterexample, expected, actual, replay, code: source } = failure;
	return [
		list(steps, counterexample === undefined ? failure.step : undefined).join('\n'),
		`**Failed at step ${failure.step}${counterexample === undefined ? '' : ' of the counterexample'}:** ${failure.problem}`,
		...(expected === undefined ? [] : [['Expected:', ...block(expected, 'text')].join('\n')]),
		...(actual === undefined ? [] : [['Actual:', ...block(actual, 'text')].join('\n')]),
		...(counterexample === undefined
			? []
			: [['Counterexample:', '', ...list(counterexample, failure.step)].join('\n')]),
		...(replay === undefined ? [] : [`Replay: ${code(replay)}`]),
		...(source === undefined ? [] : [['As code:', ...block(source, 'ts')].join('\n')])
	];
};

const tale = (record: StoryRecord): ReadonlyArray<string> => [
	`### ${record.status === 'passed' ? '✓' : '✗'} ${record.title}`,
	[
		record.kind,
		record.status,
		...(record.test === record.title ? [] : [`test: ${record.test}`])
	].join(' · '),
	...(record.failure === undefined
		? [
				list(record.steps).join('\n'),
				...(record.final === undefined ? [] : [ends('Ends', record.final)]),
				...(record.finals ?? []).map(({ order, final }) =>
					ends(order.length === 0 ? 'Ends' : `Ends in order ${order.join(', ')}`, final)
				)
			]
		: failed(record.failure, record.steps)),
	...(record.cases === undefined || record.cases.length === 0
		? []
		: [`**Cases** ${record.cases.join(', ')}`])
];

/**
 * Renders a report as a Markdown page to review: a section per test file, one per tale with its
 * status, its numbered steps with their values, where it ended and the cases it touched, or why
 * it failed, with an exploration's counterexample and the code that makes it.
 */
export const markdown = (report: StoryReport): string => {
	const passed = report.stories.filter((record) => record.status === 'passed').length;
	const files = Arr.groupBy(report.stories, (record) => record.file);
	return `${[
		'# Stories',
		`${report.stories.length} tales: ${passed} passed, ${report.stories.length - passed} failed.`,
		...Object.entries(files).flatMap(([file, records]) =>
			Arr.prepend(records.flatMap(tale), `## ${file}`)
		)
	].join('\n\n')}\n`;
};
