// Reading a story record back, as docs/story-record.md shows it, from the reporter's fixture.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { StoryRecord } from 'effect-storytime/testing';

const path = fileURLToPath(new URL('../fixtures/report.json', import.meta.url));

it.effect('a report reads back as typed records', () =>
	Effect.gen(function* () {
		// #region decode
		const text = yield* Effect.promise(() => readFile(path, 'utf8'));
		// Fails with a SchemaError for anything but a version 4 report.
		const report = yield* StoryRecord.decode(text);
		const failed = report.stories.find((record) => record.status === 'failed');
		// #endregion decode
		// #region failed
		expect(failed).toEqual({
			kind: 'Exploration',
			title: 'the lamp counts switches',
			file: 'checks/lamp.stories.ts',
			test: 'the lamp counts switches',
			steps: [
				{
					verb: 'explore',
					label: '100 runs of up to 30 steps, seed "the lamp counts switches", with restarts',
					values: []
				}
			],
			status: 'failed',
			failure: {
				step: 2,
				line: 'explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts',
				problem: 'invariant countIsSmall does not hold',
				actual: '{"at":"2026-11-04T00:00:00.000Z","count":10,"on":1}',
				// The shrunk path as steps; `step` numbers its failing one.
				counterexample: [
					{
						verb: 'given',
						values: [{ value: { at: '2026-11-03T00:00:00.000Z', count: 0, on: 0 } }]
					},
					{
						verb: 'send',
						values: [{ tag: 'Switched', value: { at: '2026-11-04T00:00:00.000Z', by: 10 } }]
					}
				],
				// `Exploration.check(exploration, { replay })` checks just this path again.
				replay: '[1,"the lamp counts switches",13,4,[1,3,2],"PropertyError"]',
				// The same path as a story to paste into a test, its values decoded by the program's Schemas.
				code: [
					'const model = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Model)));',
					'const message = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Message)));',
					'Story.make(',
					'\t"the lamp counts switches",',
					'\tprogram,',
					`\tstory.given(model('{"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}')),`,
					`\tstory.send(message('{"_tag":"Switched","at":"2026-11-04T00:00:00.000Z","by":10}'))`,
					')'
				].join('\n')
			}
		});
		// #endregion failed
	})
);

it.effect('a report renders as a page to review', () =>
	Effect.gen(function* () {
		const text = yield* Effect.promise(() => readFile(path, 'utf8'));
		// #region markdown
		const report = yield* StoryRecord.decode(text);
		const page = StoryRecord.markdown(report);
		// #endregion markdown
		yield* Effect.promise(() => expect(page).toMatchFileSnapshot('../fixtures/report.md'));
	})
);
