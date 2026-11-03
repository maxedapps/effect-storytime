/**
 * An exploration generates stories instead of telling one: random paths of messages, command
 * answers and restarts through a Program, each checked with every strict rule a story runs except
 * command assertions. A failing path shrinks to a short story, its counterexample.
 */
import { Arbitrary, Effect } from 'effect';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import type { Program, Tagged } from './Program.ts';
import * as Story from './Story.ts';
export interface Options<Model, Message, Command> {
    /** The models a path starts from. */
    readonly given: Arbitrary.Arbitrary<Model>;
    /** The messages a path sends; by default any the Message Schema allows. */
    readonly send?: Arbitrary.Arbitrary<Message>;
    /** The messages a pending command completes with; a command with none stays pending. */
    readonly replies?: (command: Command) => ReadonlyArray<Message>;
    /** The messages a pending command streams while it stays pending. */
    readonly emits?: (command: Command) => ReadonlyArray<Message>;
    /** Whether paths restart; by default they do. */
    readonly restarts?: boolean;
    /** How many paths to check; 100 by default. */
    readonly runs?: number;
    /** The most actions a path takes; 30 by default. */
    readonly steps?: number;
    /** The seed paths come from; the title by default, so every run checks the same paths. */
    readonly seed?: string | number;
}
declare const Exploration_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Readonly<A> & {
    readonly _tag: "Exploration";
} & import("effect/Pipeable").Pipeable;
export declare class Exploration<Model, Message extends Tagged, Command extends Tagged> extends Exploration_base<{
    readonly title: string;
    readonly program: Program<Model, Message, Command>;
    readonly given: Arbitrary.Arbitrary<Model>;
    readonly send: Arbitrary.Arbitrary<Message>;
    readonly replies: (command: Command) => ReadonlyArray<Message>;
    readonly emits: (command: Command) => ReadonlyArray<Message>;
    readonly restarts: boolean;
    readonly runs: number;
    readonly steps: number;
    readonly seed: string | number;
}> {
    [TypeId](): Told;
}
export declare const make: <Model, Message extends Tagged, Command extends Tagged>(title: string, program: Program<Model, Message, Command>, options: Options<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>) => Exploration<Model, Message, Command>;
/** Renders an exploration as its one line; a failure's counterexample is a story's lines. */
export declare const lines: <Model, Message extends Tagged, Command extends Tagged>(exploration: Exploration<Model, Message, Command>) => ReadonlyArray<string>;
/** What a passing exploration checked: its runs and every case its paths sent, produced or reached. */
export interface Explored {
    readonly runs: number;
    readonly cases: ReadonlyArray<string>;
}
/**
 * Checks `runs` generated paths. A failure carries the shrunk path as a story's lines, its
 * counterexample, with `step` numbering the line that failed, and a `replay` token that checks
 * just that path again.
 */
export declare const check: <Model, Message extends Tagged, Command extends Tagged>(exploration: Exploration<Model, Message, Command>, options?: {
    readonly replay?: Arbitrary.Replay;
} | undefined) => Effect.Effect<Explored, Story.StoryFailure, never>;
export {};
