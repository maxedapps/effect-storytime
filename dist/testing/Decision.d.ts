/**
 * A decision tells how a Decider rules, as steps: start from a state, send commands and name the
 * events or the rejection each one gives. `run` checks it in memory with the strict rules,
 * `against` through `handle`'s transaction on a real Store.
 */
import { Data, Effect } from 'effect';
import type { Context } from 'effect';
import type { Decider, Store } from '../Decider.ts';
import type { Tagged } from '../Program.ts';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import { StoryFailure } from './Story.ts';
export type Step<State, Command, Event, Rejection> = Data.TaggedEnum<{
    Given: {
        readonly state: State;
    };
    When: {
        readonly command: Command;
    };
    Accepted: {
        readonly events: ReadonlyArray<Event>;
    };
    Rejected: {
        readonly rejection: Rejection;
    };
    State: {
        readonly expected: State;
    };
    Satisfies: {
        readonly label: string;
        readonly check: (state: State) => boolean;
    };
}>;
/** The steps of decisions about one Decider, typed by it, so steps built anywhere need no type parameters. */
export interface Builders<State, Command, Event, Rejection> {
    /** Starts the decision from a state. It comes first and only once. */
    readonly given: (state: State) => Step<State, Command, Event, Rejection>;
    /** Decides a command. The next step names its events or its rejection. */
    readonly when: (command: Command) => Step<State, Command, Event, Rejection>;
    /** Requires the command to give exactly these events, in this order; `accepted()` means none. */
    readonly accepted: (...events: ReadonlyArray<Event>) => Step<State, Command, Event, Rejection>;
    /** Requires the command to be rejected with `rejection`. */
    readonly rejected: (rejection: Rejection) => Step<State, Command, Event, Rejection>;
    /** Requires the state to equal `expected`. */
    readonly state: (expected: State) => Step<State, Command, Event, Rejection>;
    /** Requires the state to pass a check, shown in lines by its label. */
    readonly satisfies: (label: string, check: (state: State) => boolean) => Step<State, Command, Event, Rejection>;
}
/** The step builders for decisions about `decider`; only its types matter. */
export declare const of: <State, Command extends Tagged, Event, Rejection>(_decider: Decider<State, Command, Event, Rejection>) => Builders<State, Command, Event, Rejection>;
declare const Decision_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Readonly<A> & {
    readonly _tag: "Decision";
} & import("effect/Pipeable").Pipeable;
export declare class Decision<State, Command extends Tagged, Event, Rejection> extends Decision_base<{
    readonly title: string;
    readonly decider: Decider<State, Command, Event, Rejection>;
    readonly steps: ReadonlyArray<Step<State, Command, Event, Rejection>>;
}> {
    [TypeId](): Told;
}
export declare const make: <State, Command extends Tagged, Event, Rejection>(title: string, decider: Decider<State, Command, Event, Rejection>, ...body: ReadonlyArray<Step<State, Command, Event, Rejection>>) => Decision<State, Command, Event, Rejection>;
/** What a passing decision reached: its final state, also as a line, and the cases it touched. */
export interface Outcome<State> {
    readonly state: State;
    readonly final: string;
    readonly cases: ReadonlyArray<string>;
}
/** Renders a decision as plain lines, from its value alone. */
export declare const lines: <State, Command extends Tagged, Event, Rejection>(decision: Decision<State, Command, Event, Rejection>) => ReadonlyArray<string>;
/** Runs a decision in memory: every step and every strict rule. */
export declare const run: <State, Command extends Tagged, Event, Rejection>(decision: Decision<State, Command, Event, Rejection>) => Effect.Effect<Outcome<State>, StoryFailure>;
/**
 * Runs a decision through `handle`'s transaction on a real Store, under `key`, with every strict
 * rule. The test arranges the Store beforehand: `given` loads the state under `key` (or `initial`)
 * and fails unless it equals the given state. Each `when` decides and saves, and `state` loads and
 * checks what the Store gives back. Store errors fail as they are.
 */
export declare const against: <State, Command extends Tagged, Event, Rejection, Id, Key, E>(decision: Decision<State, Command, Event, Rejection>, Store: Context.Key<Id, Store<Key, State, Event, E>>, key: Key) => Effect.Effect<Outcome<State>, StoryFailure | E, Id>;
export {};
//# sourceMappingURL=Decision.d.ts.map