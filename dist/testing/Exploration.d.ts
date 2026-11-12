/**
 * An exploration generates tales instead of telling one: random paths of messages, command answers
 * and restarts through a Program, or of commands through a Decider, each checked with every strict
 * rule a story or decision runs except command assertions. A failing path shrinks to a short tale,
 * its counterexample.
 */
import { Arbitrary, Effect } from 'effect';
import type { Decider } from '../Decider.ts';
import { Broken } from './internal/check.ts';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import type { Program, Tagged } from '../Program.ts';
import * as Story from './Story.ts';
interface Settings {
    /** How many paths to check; 100 by default. */
    readonly runs?: number;
    /** The most actions a path takes; 30 by default. */
    readonly steps?: number;
    /** The seed paths come from; the title by default, so every run checks the same paths. */
    readonly seed?: string | number;
}
export interface Options<Model, Message, Command> extends Settings {
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
}
export interface DecisionOptions<State, Command> extends Settings {
    /** The states a path starts from; the Decider's `initial` by default. */
    readonly given?: Arbitrary.Arbitrary<State>;
    /** The commands a path decides; by default any the Command Schema allows. */
    readonly when?: Arbitrary.Arbitrary<Command>;
}
/** One generated path, walked: the cases it touched, or where it broke a rule. */
type Walk = Effect.Effect<ReadonlyArray<string>, Broken>;
declare const Exploration_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Readonly<A> & {
    readonly _tag: "Exploration";
} & import("effect/Pipeable").Pipeable;
export declare class Exploration extends Exploration_base<{
    readonly title: string;
    readonly subject: object;
    readonly runs: number;
    readonly steps: number;
    readonly seed: string | number;
    readonly restarts: boolean;
    readonly walks: Arbitrary.Arbitrary<Walk>;
}> {
    [TypeId](): Told;
}
/** Explores a Program: paths of sent messages, command answers and restarts from a given model. */
export declare const make: <Model, Message extends Tagged, Command extends Tagged>(title: string, program: Program<Model, Message, Command>, options: Options<NoInfer<Model>, NoInfer<Message>, NoInfer<Command>>) => Exploration;
/** Explores a Decider: paths of commands decided one after another from a given state. */
export declare const decisions: <State, Command, Event, Rejection>(title: string, decider: Decider<State, Command, Event, Rejection>, options?: DecisionOptions<NoInfer<State>, NoInfer<Command>>) => Exploration;
/** Renders an exploration as its one line; a failure's counterexample is a tale's lines. */
export declare const lines: (exploration: Exploration) => ReadonlyArray<string>;
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
export declare const check: (exploration: Exploration, options?: {
    readonly replay?: Arbitrary.Replay;
} | undefined) => Effect.Effect<Explored, Story.StoryFailure, never>;
export {};
//# sourceMappingURL=Exploration.d.ts.map