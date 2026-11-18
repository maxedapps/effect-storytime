/**
 * Steps as data: what every tale says, step by step, as a verb and the values it names. Records
 * keep it, lines and Markdown render it, and a counterexample prints it as code.
 */
import { Schema } from 'effect';
/**
 * A value a step names: its `_tag`, its canonical JSON without the tag (absent for a tag alone),
 * or why it has no JSON.
 */
export declare const Value: Schema.Struct<{
    readonly tag: Schema.optionalKey<Schema.String>;
    readonly value: Schema.optionalKey<Schema.Codec<Schema.Json, Schema.Json, never, never>>;
    readonly notJson: Schema.optionalKey<Schema.String>;
}>;
export type Value = typeof Value.Type;
export declare const Verb: Schema.Literals<readonly ["given", "send", "model", "satisfies", "commands", "resolve", "emit", "restart", "any order", "when", "accepted", "rejected", "state", "explore"]>;
export type Verb = typeof Verb.Type;
/**
 * One step: its verb, how deep it sits in `any order`s (absent at the top), a `satisfies` label or
 * an exploration's settings, and its values in the order its builder takes them.
 */
export declare const Step: Schema.Struct<{
    readonly verb: Schema.Literals<readonly ["given", "send", "model", "satisfies", "commands", "resolve", "emit", "restart", "any order", "when", "accepted", "rejected", "state", "explore"]>;
    readonly depth: Schema.optionalKey<Schema.Int>;
    readonly label: Schema.optionalKey<Schema.String>;
    readonly values: Schema.$Array<Schema.Struct<{
        readonly tag: Schema.optionalKey<Schema.String>;
        readonly value: Schema.optionalKey<Schema.Codec<Schema.Json, Schema.Json, never, never>>;
        readonly notJson: Schema.optionalKey<Schema.String>;
    }>>;
}>;
export type Step = typeof Step.Type;
/** Whether a step's second value is what its first gave, shown after an arrow. */
export declare const arrowed: (verb: Verb) => boolean;
/**
 * A step's values, each shown by `show`, joined as one: `none` for an empty list, nothing for a
 * step without values.
 */
export declare const shown: ({ verb, values }: Step, show: (value: Value) => string) => ReadonlyArray<string>;
/** A step as one line, indented two spaces per `any order` around it. */
export declare const line: (step: Step) => string;
/** A step from its verb, depth and values, and a label where it has one. */
export declare const say: (verb: Verb, depth: number, values: ReadonlyArray<Value>, label?: string) => Step;
//# sourceMappingURL=steps.d.ts.map