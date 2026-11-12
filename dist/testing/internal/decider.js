/**
 * A Decider's strict rules and the cases it touches, shared by decisions and explored paths: `check`
 * validates a state and gives its decoded copy, `rule` runs `handle`'s transition with `decide` and
 * `evolve` run twice each on copies, validating what they give and continuing from copies of it, so
 * no callback holds a value the tale names.
 */
import { Effect, Option, Result } from 'effect';
import { tagger } from '../../internal/canonical.js';
import { holds, pure, role } from './check.js';
import { transition } from '../../internal/transition.js';
/** The checks on a Decider's Schemas. */
export const checks = (decider) => ({
    state: role(decider.State, 'the state'),
    command: role(decider.Command, 'the command'),
    event: role(decider.Event, 'the event'),
    rejection: role(decider.Rejection, 'the rejection')
});
const joined = (parts) => Effect.map(Effect.all(parts), JSON.stringify);
/** Names the case of a tagged value as `<role>.<tag>`; an untagged value names none. */
const caseIn = (schema, name) => {
    const tag = tagger(schema);
    return (value) => Option.match(tag(value), { onNone: () => [], onSome: (found) => [`${name}.${found}`] });
};
/** The cases a state, a command and what it gave touch. */
export const caser = (decider) => {
    const state = caseIn(decider.State, 'State');
    const command = caseIn(decider.Command, 'Command');
    const event = caseIn(decider.Event, 'Event');
    const rejection = caseIn(decider.Rejection, 'Rejection');
    return {
        state,
        ruled: (given, { decided, states }) => [
            ...command(given),
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
    const checked = transition({
        decide: (current, command) => Effect.flatMap(pure('decide', joined([the.state.key(current), the.command.key(command)]), () => decider.decide(current, command), output), (decided) => Result.match(decided, {
            onFailure: () => Effect.succeed(decided),
            onSuccess: (events) => Effect.map(Effect.forEach(events, the.event.copy), (copies) => Result.succeed(copies))
        })),
        evolve: (from, event) => pure('evolve', joined([the.state.key(from), the.event.key(event)]), () => decider.evolve(from, event), (next) => Effect.andThen(the.state.valid(next), the.state.key(next))).pipe(Effect.flatMap(the.state.copy)),
        holds: invariants
    });
    /** Validates the command and runs the checked transition on a copy of it. */
    const rule = (current, command) => Effect.andThen(the.command.valid(command), Effect.flatMap(the.command.copy(command), (copy) => checked(current, copy)));
    return { check, rule };
};
//# sourceMappingURL=decider.js.map