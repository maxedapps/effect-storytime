/**
 * A Vitest reporter that writes the run's story records to one JSON file, the `StoryReport`.
 * The same tests give the same bytes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { Array as Arr, Order } from 'effect';
/** By file and test, then by content, as a test's concurrent tales finish in any order. */
const byPlace = Order.combineAll([
    Order.mapInput(Order.String, (record) => record.file),
    Order.mapInput(Order.String, (record) => record.test),
    Order.mapInput(Order.String, (record) => JSON.stringify(record))
]);
export class StoryReporter {
    #outputFile;
    #root;
    constructor(options = {}) {
        this.#outputFile = options.outputFile ?? 'stories.json';
    }
    onInit(vitest) {
        this.#root = vitest.config.root;
    }
    async onTestRunEnd(modules) {
        const stories = modules.flatMap((module) => Array.from(module.children.allTests()).flatMap((test) => (test.meta().storytime ?? []).map((told) => ({
            kind: told.kind,
            title: told.title,
            file: posix.relative(this.#root, module.moduleId),
            test: test.fullName,
            lines: told.lines,
            status: told.status,
            final: told.final,
            failure: told.failure,
            cases: told.cases
        }))));
        const path = resolve(this.#root, this.#outputFile);
        await mkdir(dirname(path), { recursive: true });
        const report = { version: 1, stories: Arr.sort(stories, byPlace) };
        await writeFile(path, `${JSON.stringify(report, null, '\t')}\n`);
    }
}
//# sourceMappingURL=reporter.js.map