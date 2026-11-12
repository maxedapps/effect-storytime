/**
 * Tells tales as Vitest tests through `@effect/vitest`. Each told tale leaves its record in the
 * test's meta, where the `Reporter` collects it into one JSON file, the `StoryReport`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { it } from '@effect/vitest';
import { Array as Arr, Cause, Effect, Exit, Option, Order, Schema } from 'effect';
import type { TestContext } from 'vitest';
import type { Reporter as VitestReporter, TestModule, Vitest } from 'vitest/node';
import type { Decider } from '../Decider.ts';
import type { Program, Tagged } from '../Program.ts';
import * as Story from './Story.ts';
import type { StoryRecord, StoryReport } from './StoryRecord.ts';
import * as Tale from './Tale.ts';

/** A tale's record before the reporter adds the file and test that told it. */
export type Told = Omit<StoryRecord, 'file' | 'test'>;

declare module 'vitest' {
	interface TaskMeta {
		storytime?: ReadonlyArray<Told>;
	}
}

const isStoryFailure = Schema.is(Story.StoryFailure);

const told = (tale: Tale.Tale, exit: Exit.Exit<Tale.Reached, unknown>): Told => ({
	kind: tale._tag,
	title: tale.title,
	lines: Tale.lines(tale),
	...Exit.match(exit, {
		onSuccess: ({ final, cases }): Pick<Told, 'status' | 'final' | 'cases'> => ({
			status: 'passed',
			final,
			cases
		}),
		onFailure: (cause): Pick<Told, 'status' | 'failure'> => ({
			status: 'failed',
			failure: Option.getOrUndefined(
				Option.map(
					Option.filter(Cause.findErrorOption(cause), isStoryFailure),
					({ step, line, problem, expected, actual, counterexample, replay }) => ({
						step,
						line,
						problem,
						expected,
						actual,
						counterexample,
						replay
					})
				)
			)
		})
	})
});

/**
 * Runs a tale, or `run` when it needs services (such as `Decision.against` inside `layer(...)`),
 * and records it in the test's meta. A failure fails the test.
 */
export const tell = <E = never, R = never>(
	ctx: TestContext,
	tale: Tale.Tale,
	run?: Effect.Effect<Tale.Reached, Story.StoryFailure | E, R>
): Effect.Effect<Tale.Reached, Story.StoryFailure | E, R> =>
	Effect.onExit(run ?? Tale.run(tale), (exit) =>
		Effect.sync(() => {
			ctx.task.meta.storytime = [...(ctx.task.meta.storytime ?? []), told(tale, exit)];
		})
	);

/** Registers one test per tale, named by its title. */
export const stories = (...tales: ReadonlyArray<Tale.Tale>): void => {
	for (const tale of tales) it.effect(tale.title, (ctx) => tell(ctx, tale));
};

/** Registers one test requiring a Program's or a Decider's tales to touch every one of its cases. */
export const covers = <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	State,
	DeciderCommand,
	Event,
	Rejection
>(
	subject: Program<Model, Message, Command> | Decider<State, DeciderCommand, Event, Rejection>,
	tales: ReadonlyArray<Tale.Tale>
): void => {
	it.effect('its tales touch every case', () => Tale.covers(subject, tales));
};

export interface ReporterOptions {
	/** Where to write the report, relative to the Vitest root; `stories.json` by default. */
	readonly outputFile?: string;
}

/** By file and test, then by content, as a test's concurrent tales finish in any order. */
const byPlace = Order.combineAll([
	Order.mapInput(Order.String, (record: StoryRecord) => record.file),
	Order.mapInput(Order.String, (record: StoryRecord) => record.test),
	Order.mapInput(Order.String, (record: StoryRecord) => JSON.stringify(record))
]);

/** Writes the run's story records to one JSON file, the `StoryReport`; the same tests give the same bytes. */
export class Reporter implements VitestReporter {
	readonly #outputFile: string;
	#root!: string;

	constructor(options: ReporterOptions = {}) {
		this.#outputFile = options.outputFile ?? 'stories.json';
	}

	onInit(vitest: Vitest) {
		this.#root = vitest.config.root;
	}

	async onTestRunEnd(modules: ReadonlyArray<TestModule>) {
		const records = modules.flatMap((module) =>
			Array.from(module.children.allTests()).flatMap((test) =>
				(test.meta().storytime ?? []).map((tale: Told): StoryRecord => ({
					kind: tale.kind,
					title: tale.title,
					file: posix.relative(this.#root, module.moduleId),
					test: test.fullName,
					lines: tale.lines,
					status: tale.status,
					final: tale.final,
					failure: tale.failure,
					cases: tale.cases
				}))
			)
		);
		const path = resolve(this.#root, this.#outputFile);
		await mkdir(dirname(path), { recursive: true });
		const report: StoryReport = { version: 3, stories: Arr.sort(records, byPlace) };
		await writeFile(path, `${JSON.stringify(report, null, '\t')}\n`);
	}
}
