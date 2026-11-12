import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { createVitest } from 'vitest/node';
import { StoryRecord, Vitest } from 'effect-storytime/testing';

const root = fileURLToPath(new URL('fixtures/report', import.meta.url));

/**
 * Runs the fixture stories in their two projects and reads the report the reporter wrote;
 * `reversed` tells a test's tales in the opposite order.
 */
const report = (options: Vitest.ReporterOptions, reversed: boolean) =>
	Effect.promise(async () => {
		const vitest = await createVitest({
			root,
			config: join(root, 'vitest.config.ts'),
			watch: false,
			env: { STORYTIME_REVERSED: reversed ? '1' : '0' },
			reporters: [new Vitest.Reporter(options)]
		});
		await vitest.start();
		await vitest.close();
		return readFile(resolve(root, options.outputFile ?? 'stories.json'), 'utf8');
	}).pipe(
		// The fixtures fail on purpose, which marks the process failed.
		Effect.ensuring(Effect.sync(() => (process.exitCode = undefined)))
	);

const scratch = Effect.acquireRelease(
	Effect.promise(() => mkdtemp(join(tmpdir(), 'storytime-report-'))),
	(dir) => Effect.promise(() => rm(dir, { recursive: true }))
);

describe('Vitest.Reporter', () => {
	it.effect(
		'writes every told tale, sorted, the same whatever order they were told in',
		() =>
			Effect.gen(function* () {
				const dir = yield* scratch;
				const first = yield* report({}, false).pipe(
					Effect.ensuring(Effect.promise(() => rm(join(root, 'stories.json'))))
				);
				const second = yield* report({ outputFile: join(dir, 'nested', 'stories.json') }, true);
				expect(second).toBe(first);
				yield* Effect.promise(() => expect(first).toMatchFileSnapshot('fixtures/report.json'));
				expect(yield* StoryRecord.decode(first)).toEqual(JSON.parse(first));
			}),
		// Two Vitest runs, slower still under Stryker's instrumentation.
		60_000
	);

	it.effect('reads back only a report of a version it knows', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(StoryRecord.decode('{"version":1,"stories":[]}'));
			expect(failure.message).toBe('Expected 2\n  at ["version"]');
		})
	);

	it.effect('reads back only records it knows', () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				StoryRecord.decode('{"version":2,"stories":[{"kind":"Saga"}]}')
			);
			expect(failure.message).toContain('at ["stories"][0]["kind"]');
		})
	);
});
