/**
 * A Decider's strict rules and the cases it touches, shared by decisions and explored paths: `check`
 * validates a state and gives its decoded copy, `rule` runs `handle`'s transition with `decide` and
 * `evolve` run twice each on copies, validating what they give and continuing from copies of it, so
 * no callback holds a value the tale names.
 */
import { Effect, Result } from 'effect';
import type { Decider } from '../../Decider.ts';
import type { Problem } from './check.ts';
import type { Transition } from '../../internal/transition.ts';
export type Decided<Event, Rejection> = Result.Result<ReadonlyArray<Event>, Rejection>;
/** One command a step decided: the state before, the command, what `decide` gave and the state reached. */
export interface Ruling<State, Command, Event, Rejection> {
    readonly before: State;
    readonly command: Command;
    readonly decided: Decided<Event, Rejection>;
    readonly after: State;
}
/** The checks on a Decider's Schemas. */
export declare const checks: <State, Command, Event, Rejection>(decider: Decider<State, Command, Event, Rejection>) => {
    state: {
        valid: (value: State) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: State) => Effect.Effect<string, Problem, never>;
        copy: (value: State) => Effect.Effect<State, Problem, never>;
        show: (value: State) => string;
        satisfies: (value: State, label: string, check: (value: State) => boolean) => Effect.Effect<void, Problem, never>;
    };
    command: {
        valid: (value: Command) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: Command) => Effect.Effect<string, Problem, never>;
        copy: (value: Command) => Effect.Effect<Command, Problem, never>;
        show: (value: Command) => string;
        satisfies: (value: Command, label: string, check: (value: Command) => boolean) => Effect.Effect<void, Problem, never>;
    };
    event: {
        valid: (value: Event) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: Event) => Effect.Effect<string, Problem, never>;
        copy: (value: Event) => Effect.Effect<Event, Problem, never>;
        show: (value: Event) => string;
        satisfies: (value: Event, label: string, check: (value: Event) => boolean) => Effect.Effect<void, Problem, never>;
    };
    rejection: {
        valid: (value: Rejection) => Effect.Effect<void, never, never> | Effect.Effect<never, Problem, never>;
        key: (value: Rejection) => Effect.Effect<string, Problem, never>;
        copy: (value: Rejection) => Effect.Effect<Rejection, Problem, never>;
        show: (value: Rejection) => string;
        satisfies: (value: Rejection, label: string, check: (value: Rejection) => boolean) => Effect.Effect<void, Problem, never>;
    };
};
/** The cases a state, a command and what it gave touch. */
export declare const caser: <State, Command, Event, Rejection>(decider: Decider<State, Command, Event, Rejection>) => {
    state: (value: State) => ReadonlyArray<string>;
    ruled: (given: Command, { decided, states }: Transition<State, Event, Rejection>) => string[];
};
/** The strict rules of `decider`; explored paths check their `properties` on every ruling too. */
export declare const strict: <State, Command, Event, Rejection>(decider: Decider<State, Command, Event, Rejection>, properties?: Readonly<Record<string, (ruling: Ruling<State, Command, Event, Rejection>) => boolean>>) => {
    check: (current: State) => Effect.Effect<State, Problem, never>;
    rule: (current: State, command: Command) => Effect.Effect<Transition<State, Event, Rejection>, Problem, never>;
};
//# sourceMappingURL=decider.d.ts.map