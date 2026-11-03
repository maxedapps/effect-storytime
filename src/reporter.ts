/**
 * A Vitest reporter that writes the run's story records to one JSON file, the `StoryReport`.
 * The same tests give the same bytes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { Array as Arr, Order } from 'effect';
import type { Reporter, TestModule, Vitest } from 'vitest/node';
import type { StoryRecord, StoryReport } from './StoryRecord.ts';
import type { Told } from './vitest.ts';

export interface Options {
	/** Where to write the report, relative to the Vitest root; `stories.json` by default. */
	readonly outputFile?: string;
}

const byPlace = Order.combine(
	Order.mapInput(Order.String, (record: StoryRecord) => record.file),
	Order.mapInput(Order.String, (record: StoryRecord) => record.test)
);

export class StoryReporter implements Reporter {
	readonly #outputFile: string;
	#root!: string;

	constructor(options: Options = {}) {
		this.#outputFile = options.outputFile ?? 'stories.json';
	}

	onInit(vitest: Vitest) {
		this.#root = vitest.config.root;
	}

	async onTestRunEnd(modules: ReadonlyArray<TestModule>) {
		const stories = modules.flatMap((module) =>
			Array.from(module.children.allTests()).flatMap((test) =>
				(test.meta().storytime ?? []).map((told: Told): StoryRecord => ({
					kind: told.kind,
					title: told.title,
					file: posix.relative(this.#root, module.moduleId),
					test: test.fullName,
					lines: told.lines,
					status: told.status,
					final: told.final,
					failure: told.failure,
					cases: told.cases
				}))
			)
		);
		const path = resolve(this.#root, this.#outputFile);
		await mkdir(dirname(path), { recursive: true });
		const report: StoryReport = { version: 1, stories: Arr.sort(stories, byPlace) };
		await writeFile(path, `${JSON.stringify(report, null, '\t')}\n`);
	}
}
