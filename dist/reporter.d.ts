import type { Reporter, TestModule, Vitest } from 'vitest/node';
export interface Options {
    /** Where to write the report, relative to the Vitest root; `stories.json` by default. */
    readonly outputFile?: string;
}
export declare class StoryReporter implements Reporter {
    #private;
    constructor(options?: Options);
    onInit(vitest: Vitest): void;
    onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void>;
}
