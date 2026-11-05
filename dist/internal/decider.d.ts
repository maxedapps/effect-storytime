/**
 * A Decider's strict rules and the cases it touches, shared by decisions and explored paths: `check`
 * validates a state and gives its decoded copy, `rule` runs `decide` and `evolve` twice each on
 * copies, validating what they give and continuing from copies of it, so no callback holds a value
 * the tale names.
 */
import { Effect, Result } from 'effect';
import type { Decider } from '../Decider.ts';
import type { Problem } from './check.ts';
import type { Ruling } from './store.ts';
export type Decided<Event, Rejection> = Result.Result<ReadonlyArray<Event>, Rejection>;
/** A strictly checked ruling, with every state its events reached on the way, in order. */
export interface Ruled<State, Event, Rejection> extends Ruling<State, Event, Rejection> {
    readonly states: ReadonlyArray<State>;
}
/** The checks on a Decider's Schemas. */
export declare const checks: <State, Input, Event, Rejection>(decider: Decider<State, Input, Event, Rejection>) => {
    state: {
        valid: (value: State) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: State) => Effect.Effect<string, Problem, never>;
        copy: (value: State) => Effect.Effect<State, Problem, never>;
        show: (value: State) => string;
    };
    input: {
        valid: (value: Input) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: Input) => Effect.Effect<string, Problem, never>;
        copy: (value: Input) => Effect.Effect<Input, Problem, never>;
        show: (value: Input) => string;
    };
    event: {
        valid: (value: Event) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: Event) => Effect.Effect<string, Problem, never>;
        copy: (value: Event) => Effect.Effect<Event, Problem, never>;
        show: (value: Event) => string;
    };
    rejection: {
        valid: (value: Rejection) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: Rejection) => Effect.Effect<string, Problem, never>;
        copy: (value: Rejection) => Effect.Effect<Rejection, Problem, never>;
        show: (value: Rejection) => string;
    };
};
/** The cases a state, an input and what it gave touch. */
export declare const caser: <State, Input, Event, Rejection>(decider: Decider<State, Input, Event, Rejection>) => {
    state: (value: State) => ReadonlyArray<string>;
    ruled: (given: Input, { decided, states }: Ruled<State, Event, Rejection>) => string[];
};
export declare const strict: <State, Input, Event, Rejection>(decider: Decider<State, Input, Event, Rejection>) => {
    check: (current: State) => Effect.Effect<State, Problem, never>;
    rule: (current: State, input: Input) => Effect.Effect<Ruled<State, Event, Rejection>, Problem>;
};
//# sourceMappingURL=decider.d.ts.map