/**
 * The story record: every tale a test run told, as deterministic JSON. The reporter writes a
 * `StoryReport`; tools read it back with `decode`.
 */
import { Schema } from 'effect';
/** Where and why a tale failed; for an exploration, also its counterexample and replay token. */
export declare const Failure: Schema.Struct<{
    readonly step: Schema.Int;
    readonly line: Schema.String;
    readonly problem: Schema.String;
    readonly expected: Schema.optional<Schema.String>;
    readonly actual: Schema.optional<Schema.String>;
    readonly counterexample: Schema.optional<Schema.$Array<Schema.String>>;
    readonly replay: Schema.optional<Schema.String>;
}>;
export type Failure = typeof Failure.Type;
/**
 * Where a passing story ended in one order of its `anyOrder`s, as a line. The order names the step
 * numbers of their steps as they ran, and is empty without an `anyOrder`.
 */
export declare const Final: Schema.Struct<{
    readonly order: Schema.$Array<Schema.Int>;
    readonly final: Schema.String;
}>;
export type Final = typeof Final.Type;
export declare const StoryRecord: Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["Story", "Exploration", "Decision"]>;
    readonly title: Schema.String;
    /** The test file, posix and relative to the Vitest root. */
    readonly file: Schema.String;
    /** The test's full name, its suites joined by ` > `. */
    readonly test: Schema.String;
    readonly lines: Schema.$Array<Schema.String>;
    readonly status: Schema.Literals<readonly ["passed", "failed"]>;
    /** The final state as a line, once a decision passed. */
    readonly final: Schema.optional<Schema.String>;
    /** Where a passing story ended, one entry per order. */
    readonly finals: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly order: Schema.$Array<Schema.Int>;
        readonly final: Schema.String;
    }>>>;
    /** Present when the tale failed with a `StoryFailure`; another error leaves only the status. */
    readonly failure: Schema.optional<Schema.Struct<{
        readonly step: Schema.Int;
        readonly line: Schema.String;
        readonly problem: Schema.String;
        readonly expected: Schema.optional<Schema.String>;
        readonly actual: Schema.optional<Schema.String>;
        readonly counterexample: Schema.optional<Schema.$Array<Schema.String>>;
        readonly replay: Schema.optional<Schema.String>;
    }>>;
    /** The cases a passing story or exploration sent, produced or reached. */
    readonly cases: Schema.optional<Schema.$Array<Schema.String>>;
}>;
export type StoryRecord = typeof StoryRecord.Type;
/** A run's records, sorted by file and then test, with no timings or absolute paths. */
export declare const StoryReport: Schema.Struct<{
    readonly version: Schema.Literal<3>;
    readonly stories: Schema.$Array<Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["Story", "Exploration", "Decision"]>;
        readonly title: Schema.String;
        /** The test file, posix and relative to the Vitest root. */
        readonly file: Schema.String;
        /** The test's full name, its suites joined by ` > `. */
        readonly test: Schema.String;
        readonly lines: Schema.$Array<Schema.String>;
        readonly status: Schema.Literals<readonly ["passed", "failed"]>;
        /** The final state as a line, once a decision passed. */
        readonly final: Schema.optional<Schema.String>;
        /** Where a passing story ended, one entry per order. */
        readonly finals: Schema.optional<Schema.$Array<Schema.Struct<{
            readonly order: Schema.$Array<Schema.Int>;
            readonly final: Schema.String;
        }>>>;
        /** Present when the tale failed with a `StoryFailure`; another error leaves only the status. */
        readonly failure: Schema.optional<Schema.Struct<{
            readonly step: Schema.Int;
            readonly line: Schema.String;
            readonly problem: Schema.String;
            readonly expected: Schema.optional<Schema.String>;
            readonly actual: Schema.optional<Schema.String>;
            readonly counterexample: Schema.optional<Schema.$Array<Schema.String>>;
            readonly replay: Schema.optional<Schema.String>;
        }>>;
        /** The cases a passing story or exploration sent, produced or reached. */
        readonly cases: Schema.optional<Schema.$Array<Schema.String>>;
    }>>;
}>;
export type StoryReport = typeof StoryReport.Type;
/** Reads a report from the JSON text the reporter wrote. */
export declare const decode: (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => import("effect/Effect").Effect<{
    readonly version: 3;
    readonly stories: readonly {
        readonly kind: "Decision" | "Exploration" | "Story";
        readonly title: string;
        readonly file: string;
        readonly test: string;
        readonly lines: readonly string[];
        readonly status: "failed" | "passed";
        readonly final?: string | undefined;
        readonly finals?: readonly {
            readonly order: readonly number[];
            readonly final: string;
        }[] | undefined;
        readonly failure?: {
            readonly step: number;
            readonly line: string;
            readonly problem: string;
            readonly expected?: string | undefined;
            readonly actual?: string | undefined;
            readonly counterexample?: readonly string[] | undefined;
            readonly replay?: string | undefined;
        } | undefined;
        readonly cases?: readonly string[] | undefined;
    }[];
}, Schema.SchemaError, never>;
//# sourceMappingURL=StoryRecord.d.ts.map