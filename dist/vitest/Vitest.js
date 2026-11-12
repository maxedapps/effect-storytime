/**
 * Tells tales as Vitest tests through `@effect/vitest`. Each told tale leaves its record in the
 * test's meta, where the `Reporter` collects it into one JSON file, the `StoryReport`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { it } from '@effect/vitest';
import { Array as Arr, Cause, Effect, Exit, Option, Order, Schema, Struct } from 'effect';
import * as Story from '../testing/Story.js';
import { StoryRecord } from '../testing/StoryRecord.js';
import * as Tale from '../testing/Tale.js';
/** A tale's record before the reporter adds the file and test that told it. */
const Told = Schema.Struct(Struct.omit(StoryRecord.fields, ['file', 'test']));
const isStoryFailure = Schema.is(Story.StoryFailure);
/** Keeps exactly the record's fields, whatever else the run's values carry (a story's models). */
const encodeTold = Schema.encodeSync(Told);
const told = (tale, exit) => encodeTold({
    kind: tale._tag,
    title: tale.title,
    lines: Tale.lines(tale),
    ...Exit.match(exit, {
        onSuccess: (reached) => ({ status: 'passed', ...reached }),
        onFailure: (cause) => ({
            status: 'failed',
            failure: Option.getOrUndefined(Option.filter(Cause.findErrorOption(cause), isStoryFailure))
        })
    })
});
/**
 * Runs a tale, or `run` when it needs services (such as `Decision.against` inside `layer(...)`),
 * and records it in the test's meta. A failure fails the test.
 */
export const tell = (ctx, tale, run) => Effect.onExit(run ?? Tale.run(tale), (exit) => Effect.sync(() => {
    ctx.task.meta.storytime = [...(ctx.task.meta.storytime ?? []), told(tale, exit)];
}));
/** Registers one test per tale, named by its title. */
export const stories = (...tales) => {
    for (const tale of tales)
        it.effect(tale.title, (ctx) => tell(ctx, tale));
};
/** Registers one test requiring a Program's or a Decider's tales to touch every one of its cases. */
export const covers = (subject, tales) => {
    it.effect('its tales touch every case', () => Tale.covers(subject, tales));
};
/** By file and test, then by content, as a test's concurrent tales finish in any order. */
const byPlace = Order.combineAll([
    Order.mapInput(Order.String, (record) => record.file),
    Order.mapInput(Order.String, (record) => record.test),
    Order.mapInput(Order.String, (record) => JSON.stringify(record))
]);
/** Writes the run's story records to one JSON file, the `StoryReport`; the same tests give the same bytes. */
export class Reporter {
    #outputFile;
    #root;
    constructor(options = {}) {
        this.#outputFile = options.outputFile ?? 'stories.json';
    }
    onInit(vitest) {
        this.#root = vitest.config.root;
    }
    async onTestRunEnd(modules) {
        const records = modules.flatMap((module) => Array.from(module.children.allTests()).flatMap((test) => (test.meta().storytime ?? []).map((tale) => ({
            kind: tale.kind,
            title: tale.title,
            file: posix.relative(this.#root, module.moduleId),
            test: test.fullName,
            lines: tale.lines,
            status: tale.status,
            final: tale.final,
            finals: tale.finals,
            failure: tale.failure,
            cases: tale.cases
        }))));
        const path = resolve(this.#root, this.#outputFile);
        await mkdir(dirname(path), { recursive: true });
        const report = { version: 3, stories: Arr.sort(records, byPlace) };
        await writeFile(path, `${JSON.stringify(report, null, '\t')}\n`);
    }
}
//# sourceMappingURL=Vitest.js.map