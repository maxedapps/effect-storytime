/**
 * A tale as the TypeScript source that makes it, from its steps, so a failing exploration's
 * counterexample pastes into a test as a story or decision. Each value is its canonical JSON, as
 * its line shows it, decoded by the subject's Schema for its role, so it comes back as the tale had
 * it: branded, a class instance, a `Date` or an `Option`.
 */
import type { Step, Value, Verb } from './steps.ts';
import { TypeId } from './tale.ts';
import type { Path } from './tale.ts';

/**
 * How a kind of tale is made: its builders and subject as the docs name them, the subject's
 * Schemas by the decoder each gets, and the decoders a verb's values take in order, the last one
 * for the rest.
 */
interface Kind {
	readonly builders: string;
	readonly subject: string;
	readonly schemas: Readonly<Record<string, string>>;
	readonly roles: Partial<Record<Verb, ReadonlyArray<string>>>;
}

const kinds: Record<Path['_tag'], Kind> = {
	Story: {
		builders: 'story',
		subject: 'program',
		schemas: { model: 'Model', message: 'Message', command: 'Command' },
		roles: {
			given: ['model'],
			send: ['message'],
			commands: ['command'],
			resolve: ['command', 'message'],
			emit: ['command', 'message']
		}
	},
	Decision: {
		builders: 'decision',
		subject: 'decider',
		schemas: { state: 'State', command: 'Command', event: 'Event', rejection: 'Rejection' },
		roles: {
			given: ['state'],
			when: ['command'],
			accepted: ['event'],
			rejected: ['rejection']
		}
	}
};

/** A value's canonical JSON as a string literal, its tag first; a value without JSON says why in a comment. */
const encoded = ({ tag, value, notJson }: Value): string => {
	if (notJson !== undefined) return `/* not JSON: ${notJson} */`;
	const json = JSON.stringify(tag === undefined ? value : Object.assign({ _tag: tag }, value));
	return `'${json.replaceAll(/['\\]/g, '\\$&')}'`;
};

/** The `Story.make(...)` or `Decision.make(...)` call that makes `tale`, after the decoders it uses. */
export const code = (tale: Path): string => {
	const { builders, subject, schemas, roles } = kinds[tale._tag];
	const roleOf = (verb: Verb, index: number) =>
		// Stryker disable next-line OptionalChaining: only a verb with values asks, and each of those has roles
		roles[verb]?.slice(0, index + 1).at(-1);
	const steps = tale[TypeId]().steps;
	const used = new Set(
		steps.flatMap(({ verb, values }) => values.map((_, index) => roleOf(verb, index)))
	);
	const decoders = Object.entries(schemas)
		.filter(([role]) => used.has(role))
		.map(
			([role, schema]) =>
				`const ${role} = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(${subject}.${schema})));\n`
		);
	const made = steps.map(
		({ verb, values }: Step) =>
			`${builders}.${verb}(${values.map((value, index) => `${roleOf(verb, index)}(${encoded(value)})`).join(', ')})`
	);
	return `${decoders.join('')}${tale._tag}.make(\n\t${[JSON.stringify(tale.title), subject, ...made].join(',\n\t')}\n)`;
};
