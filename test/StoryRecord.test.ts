import { describe, expect, it } from '@effect/vitest';
import { StoryRecord } from 'effect-storytime/testing';

const record = (fields: Partial<StoryRecord.StoryRecord>): StoryRecord.StoryRecord => ({
	kind: 'Story',
	title: 'a tale',
	file: 'tales.ts',
	test: 'a tale',
	steps: [],
	status: 'passed',
	...fields
});

/** The page for one record, below its header, file, title and status. */
const page = (fields: Partial<StoryRecord.StoryRecord>) =>
	StoryRecord.markdown({ version: 4, stories: [record(fields)] })
		.trimEnd()
		.split('\n\n')
		.slice(5)
		.join('\n\n');

const long = 'x'.repeat(100);

describe('markdown', () => {
	it('counts the tales and groups them by file, in the order of the report', () => {
		expect(
			StoryRecord.markdown({
				version: 4,
				stories: [
					record({ file: 'b.ts', title: 'one', test: 'one' }),
					record({ file: 'a.ts', title: 'two', test: 'two', status: 'failed' }),
					record({ file: 'b.ts', title: 'three', test: 'three' })
				]
			})
		).toBe(
			[
				'# Stories',
				'3 tales: 2 passed, 1 failed.',
				'## b.ts',
				'### ✓ one',
				'Story · passed',
				'',
				'### ✓ three',
				'Story · passed',
				'',
				'## a.ts',
				'### ✗ two',
				'Story · failed',
				''
			].join('\n\n') + '\n'
		);
	});

	it('shows short values inline and joins replies with arrows', () => {
		expect(
			page({
				steps: [
					{ verb: 'given', values: [{ value: {} }] },
					{ verb: 'resolve', values: [{ tag: 'Ask', value: { turn: 't1' } }, { tag: 'Answered' }] },
					{ verb: 'state', values: [{ value: 1 }, { value: [2] }] },
					{ verb: 'satisfies', label: 'ready', values: [] },
					{ verb: 'when', values: [{ tag: 'Odd', notJson: 'a function' }] },
					{ verb: 'when', values: [{ notJson: 'a `' }] },
					{ verb: 'accepted', values: [] }
				]
			})
		).toBe(
			[
				'- 1 **given** `{}`',
				'- 2 **resolve** Ask `turn: "t1"` → Answered',
				'- 3 **state** `1`, `[2]`',
				'- 4 **satisfies** ready',
				'- 5 **when** `not JSON: a function`',
				'- 6 **when** `` not JSON: a ` ``',
				'- 7 **accepted** none'
			].join('\n')
		);
	});

	it('spreads a step over lines once it is too wide', () => {
		expect(
			page({
				steps: [
					{
						verb: 'emit',
						depth: 1,
						values: [{ tag: 'Ask', value: { text: long } }, { tag: 'Answered' }, { notJson: long }]
					},
					{ verb: 'send', values: [{ value: long }] },
					// 100 characters, the widest line that stays one.
					{ verb: 'send', values: [{ value: 'y'.repeat(83) }] }
				]
			})
		).toBe(
			[
				'  - 1 **emit**',
				'    Ask',
				'    ```json',
				'    {',
				`      "text": "${long}"`,
				'    }',
				'    ```',
				'    →',
				'    Answered',
				'    →',
				`    \`not JSON: ${long}\``,
				'- 2 **send**',
				'  ```json',
				`  "${long}"`,
				'  ```',
				`- 3 **send** \`"${'y'.repeat(83)}"\``
			].join('\n')
		);
	});

	it('fences code that holds backticks with more of them', () => {
		expect(
			page({
				steps: [{ verb: 'given', values: [{ value: '`a``' }] }],
				status: 'failed',
				failure: {
					step: 1,
					line: 'given "`a``"',
					problem: 'it broke',
					expected: '```',
					actual: 'b',
					counterexample: undefined,
					replay: '`r',
					code: 'x'
				}
			})
		).toBe(
			[
				'- 1 ✗ **given** ```"`a``"```',
				'**Failed at step 1:** it broke',
				['Expected:', '````text', '```', '````'].join('\n'),
				['Actual:', '```text', 'b', '```'].join('\n'),
				'Replay: `` `r ``',
				['As code:', '```ts', 'x', '```'].join('\n')
			].join('\n\n')
		);
	});

	it('marks the failing step of a counterexample instead of the steps', () => {
		expect(
			page({
				kind: 'Exploration',
				steps: [{ verb: 'explore', label: '2 runs', values: [] }],
				status: 'failed',
				failure: {
					step: 1,
					line: 'given 0',
					problem: 'it broke',
					counterexample: [{ verb: 'given', values: [{ value: 0 }] }]
				}
			})
		).toBe(
			[
				'- 1 **explore** 2 runs',
				'**Failed at step 1 of the counterexample:** it broke',
				['Counterexample:', '', '- 1 ✗ **given** `0`'].join('\n')
			].join('\n\n')
		);
	});

	it('shows where a tale ended, wide finals over lines, and no cases when it reached none', () => {
		expect(
			page({
				kind: 'Decision',
				steps: [{ verb: 'given', values: [{ tag: 'Ready' }] }],
				final: { value: { text: long } },
				finals: [{ order: [], final: { tag: 'Ready' } }],
				cases: []
			})
		).toBe(
			[
				'- 1 **given** Ready',
				['**Ends**', '  ```json', '  {', `    "text": "${long}"`, '  }', '  ```'].join('\n'),
				'**Ends** Ready'
			].join('\n\n')
		);
	});
});
