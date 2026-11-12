import { Effect, Schema } from 'effect';
import type { TestContext } from 'vitest';
import type { Reporter as VitestReporter, TestModule, Vitest } from 'vitest/node';
import type { Decider } from '../Decider.ts';
import type { Program, Tagged } from '../Program.ts';
import * as Story from '../testing/Story.ts';
import * as Tale from '../testing/Tale.ts';
/** A tale's record before the reporter adds the file and test that told it. */
declare const Told: Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["Story", "Exploration", "Decision"]>;
    readonly title: Schema.String;
    readonly lines: Schema.$Array<Schema.String>;
    readonly status: Schema.Literals<readonly ["passed", "failed"]>;
    readonly final: Schema.optional<Schema.String>;
    readonly finals: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly order: Schema.$Array<Schema.Int>;
        readonly final: Schema.String;
    }>>>;
    readonly failure: Schema.optional<Schema.Struct<{
        readonly step: Schema.Int;
        readonly line: Schema.String;
        readonly problem: Schema.String;
        readonly expected: Schema.optional<Schema.String>;
        readonly actual: Schema.optional<Schema.String>;
        readonly counterexample: Schema.optional<Schema.$Array<Schema.String>>;
        readonly replay: Schema.optional<Schema.String>;
    }>>;
    readonly cases: Schema.optional<Schema.$Array<Schema.String>>;
}>;
export type Told = typeof Told.Type;
declare module 'vitest' {
    interface TaskMeta {
        storytime?: ReadonlyArray<Told>;
    }
}
/**
 * Runs a tale, or `run` when it needs services (such as `Decision.against` inside `layer(...)`),
 * and records it in the test's meta. A failure fails the test.
 */
export declare const tell: <E = never, R = never>(ctx: TestContext, tale: Tale.Tale, run?: Effect.Effect<Tale.Reached, Story.StoryFailure | E, R>) => Effect.Effect<Tale.Reached, Story.StoryFailure | E, R>;
/** Registers one test per tale, named by its title. */
export declare const stories: (...tales: ReadonlyArray<Tale.Tale>) => void;
/** Registers one test requiring a Program's or a Decider's tales to touch every one of its cases. */
export declare const covers: <Model, Message extends Tagged, Command extends Tagged, State, DeciderCommand, Event, Rejection>(subject: Program<Model, Message, Command> | Decider<State, DeciderCommand, Event, Rejection>, tales: ReadonlyArray<Tale.Tale>) => void;
export interface ReporterOptions {
    /** Where to write the report, relative to the Vitest root; `stories.json` by default. */
    readonly outputFile?: string;
}
/** Writes the run's story records to one JSON file, the `StoryReport`; the same tests give the same bytes. */
export declare class Reporter implements VitestReporter {
    #private;
    constructor(options?: ReporterOptions);
    onInit(vitest: Vitest): void;
    onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void>;
}
export {};
//# sourceMappingURL=Vitest.d.ts.map