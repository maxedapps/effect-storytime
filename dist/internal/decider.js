/**
 * A Decider's strict rules and the cases it touches, shared by decisions and explored paths: `check`
 * validates a state and gives its decoded copy, `rule` runs `decide` and `evolve` twice each on
 * copies, validating what they give and continuing from copies of it, so no callback holds a value
 * the tale names.
 */
import { Effect, Option, Result } from 'effect';
import { tagger } from './canonical.js';
import { holds, pure, role } from './check.js';
/** The checks on a Decider's Schemas. */
export const checks = (decider) => ({
    state: role(decider.State, 'the state'),
    input: role(decider.Input, 'the input'),
    event: role(decider.Event, 'the event'),
    rejection: role(decider.Rejection, 'the rejection')
});
const joined = (parts) => Effect.map(Effect.all(parts), JSON.stringify);
/** Names the case of a tagged value as `<role>.<tag>`; an untagged value names none. */
const caseIn = (schema, name) => {
    const tag = tagger(schema);
    return (value) => Option.match(tag(value), { onNone: () => [], onSome: (found) => [`${name}.${found}`] });
};
/** The cases a state, an input and what it gave touch. */
export const caser = (decider) => {
    const state = caseIn(decider.State, 'State');
    const input = caseIn(decider.Input, 'Input');
    const event = caseIn(decider.Event, 'Event');
    const rejection = caseIn(decider.Rejection, 'Rejection');
    return {
        state,
        ruled: (given, { decided, states }) => [
            ...input(given),
            ...Result.match(decided, {
                onSuccess: (events) => events.flatMap(event),
                onFailure: rejection
            }),
            ...states.flatMap(state)
        ]
    };
};
export const strict = (decider) => {
    const the = checks(decider);
    const invariants = holds(decider.invariants, the.state.show);
    const check = (current) => Effect.gen(function* () {
        yield* the.state.valid(current);
        const copy = yield* the.state.copy(current);
        yield* invariants(copy);
        return copy;
    });
    const output = (decided) => Result.match(decided, {
        onSuccess: (events) => Effect.andThen(Effect.forEach(events, the.event.valid), Effect.map(Effect.forEach(events, the.event.key), (keys) => `accepted ${JSON.stringify(keys)}`)),
        onFailure: (rejection) => Effect.andThen(the.rejection.valid(rejection), Effect.map(the.rejection.key(rejection), (key) => `rejected ${key}`))
    });
    const rule = (current, input) => Effect.gen(function* () {
        yield* the.input.valid(input);
        const copy = yield* the.input.copy(input);
        const decided = yield* pure('decide', joined([the.state.key(current), the.input.key(copy)]), () => decider.decide(current, copy), output);
        // Stryker disable next-line ArrayDeclaration: only caser reads states, and a non-state names no case
        if (Result.isFailure(decided))
            return { decided, reached: current, states: [] };
        const events = yield* Effect.forEach(decided.success, the.event.copy);
        // Stryker disable next-line ArrayDeclaration: only caser reads states, and a non-state names no case
        const states = [];
        let reached = current;
        for (const event of events) {
            const from = reached;
            reached = yield* pure('evolve', joined([the.state.key(from), the.event.key(event)]), () => decider.evolve(from, event), (next) => Effect.andThen(the.state.valid(next), the.state.key(next))).pipe(Effect.flatMap(the.state.copy));
            states.push(reached);
        }
        yield* invariants(reached);
        return { decided: Result.succeed(events), reached, states };
    });
    return { check, rule };
};
//# sourceMappingURL=decider.js.map