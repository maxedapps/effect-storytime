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
		// Fails with a SchemaError for anything but a version 2 report.
		const report = yield* StoryRecord.decode(text);
		const failed = report.stories.find((record) => record.status === 'failed');
		// #endregion decode
		// #region failed
		expect(failed).toEqual({
			kind: 'Exploration',
			title: 'the lamp counts switches',
			file: 'checks/lamp.stories.ts',
			test: 'the lamp counts switches',
			lines: ['explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts'],
			status: 'failed',
			failure: {
				step: 2,
				line: 'explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts',
				message: 'invariant countIsSmall does not hold',
				actual: '{"at":"2026-11-04T00:00:00.000Z","count":10,"on":1}',
				// The shrunk path as a story; `step` numbers its failing line.
				counterexample: [
					'given {"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}',
					'send Switched {"at":"2026-11-04T00:00:00.000Z","by":10}'
				],
				// `Exploration.check(exploration, { replay })` checks just this path again.
				replay: '[1,"the lamp counts switches",13,4,[1,3,2],"PropertyError"]'
			}
		});
		// #endregion failed
	})
);
