/**
 * A decision tells how a Decider rules, as steps: start from a state, send inputs and name the
 * events or the rejection each one gives. `run` checks it in memory with the strict rules,
 * `against` through `handle`'s transaction on a real Store.
 */
import { Data, Effect } from 'effect';
import type { Context } from 'effect';
import type { Decider, Store } from './Decider.ts';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import { StoryFailure } from './Story.ts';
export type Step<State, Input, Event, Rejection> = Data.TaggedEnum<{
    Given: {
        readonly state: State;
    };
    When: {
        readonly input: Input;
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
/** Starts the decision from a state. It comes first and only once. */
export declare const given: <State = never, Input = never, Event = never, Rejection = never>(state: NoInfer<State>) => Step<State, Input, Event, Rejection>;
/** Decides an input. The next step names its events or its rejection. */
export declare const when: <State = never, Input = never, Event = never, Rejection = never>(input: NoInfer<Input>) => Step<State, Input, Event, Rejection>;
/** Requires the input to give exactly these events, in this order; `accepted()` means none. */
export declare const accepted: <State = never, Input = never, Event = never, Rejection = never>(...events: ReadonlyArray<NoInfer<Event>>) => Step<State, Input, Event, Rejection>;
/** Requires the input to be rejected with `rejection`. */
export declare const rejected: <State = never, Input = never, Event = never, Rejection = never>(rejection: NoInfer<Rejection>) => Step<State, Input, Event, Rejection>;
/** Requires the state to equal `expected`. */
export declare const state: <State = never, Input = never, Event = never, Rejection = never>(expected: NoInfer<State>) => Step<State, Input, Event, Rejection>;
/** Requires the state to pass a check, shown in lines by its label. */
export declare const satisfies: <State = never, Input = never, Event = never, Rejection = never>(label: string, check: (current: NoInfer<State>) => boolean) => Step<State, Input, Event, Rejection>;
declare const Decision_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Readonly<A> & {
    readonly _tag: "Decision";
} & import("effect/Pipeable").Pipeable;
export declare class Decision<State, Input, Event, Rejection> extends Decision_base<{
    readonly title: string;
    readonly decider: Decider<State, Input, Event, Rejection>;
    readonly steps: ReadonlyArray<Step<State, Input, Event, Rejection>>;
}> {
    [TypeId](): Told;
}
export declare const make: <State, Input, Event, Rejection>(title: string, decider: Decider<State, Input, Event, Rejection>, ...body: ReadonlyArray<Step<State, Input, Event, Rejection>>) => Decision<State, Input, Event, Rejection>;
/** What a passing decision reached: its final state, also as a line, and the cases it touched. */
export interface Outcome<State> {
    readonly state: State;
    readonly final: string;
    readonly cases: ReadonlyArray<string>;
}
/** Renders a decision as plain lines, from its value alone. */
export declare const lines: <State, Input, Event, Rejection>(decision: Decision<State, Input, Event, Rejection>) => ReadonlyArray<string>;
/** Runs a decision in memory: every step and every strict rule. */
export declare const run: <State, Input, Event, Rejection>(decision: Decision<State, Input, Event, Rejection>) => Effect.Effect<Outcome<State>, StoryFailure>;
/**
 * Runs a decision through `handle`'s transaction on a real Store, under `key`, with every strict
 * rule: `given` saves its state, each `when` decides and saves, and `state` loads and checks what
 * the Store gives back. Store errors fail as they are.
 */
export declare const against: <State, Input, Event, Rejection, Id, Key, E>(decision: Decision<State, Input, Event, Rejection>, Store: Context.Key<Id, Store<Key, State, Event, E>>, key: Key) => Effect.Effect<Outcome<State>, StoryFailure | E, Id>;
export {};
//# sourceMappingURL=Decision.d.ts.map