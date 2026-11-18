/**
 * A decision tells how a Decider rules, as steps: start from a state, send commands and name the
 * events or the rejection each one gives. `run` checks it in memory with the strict rules,
 * `against` through `handle`'s transaction on a real Store.
 */
import { Array as Arr, Data, Effect, Option, Ref, Result } from 'effect';
import { describer } from '../internal/canonical.js';
import { Problem } from './internal/check.js';
import { caser, checks, strict } from './internal/decider.js';
import { decideIn, loadOrInitial } from '../internal/transition.js';
import { located, made, TypeId } from './internal/tale.js';
import { StoryFailure } from './Story.js';
const Step = Data.taggedEnum();
/** The step builders for decisions about `decider`; only its types matter. */
export const of = (_decider) => ({
    given: (state) => Step.Given({ state }),
    when: (command) => Step.When({ command }),
    accepted: (...events) => Step.Accepted({ events }),
    rejected: (rejection) => Step.Rejected({ rejection }),
    state: (expected) => Step.State({ expected }),
    satisfies: (label, check) => Step.Satisfies({ label, check })
});
export class Decision extends Data.TaggedClass('Decision') {
    [TypeId]() {
        return { subject: this.decider, lines: lines(this), run: run(this) };
    }
}
export const make = (title, decider, ...body) => made(new Decision({ title, decider, steps: body }), make);
const liner = (decider) => {
    const showState = describer(decider.State);
    const showCommand = describer(decider.Command);
    const showEvent = describer(decider.Event);
    const showRejection = describer(decider.Rejection);
    return (step) => Step.$match(step, {
        Given: ({ state: start }) => `given ${showState(start)}`,
        When: ({ command }) => `when ${showCommand(command)}`,
        Accepted: ({ events }) => `accepted ${events.length === 0 ? 'none' : events.map(showEvent).join(', ')}`,
        Rejected: ({ rejection }) => `rejected ${showRejection(rejection)}`,
        State: ({ expected }) => `state ${showState(expected)}`,
        Satisfies: ({ label }) => `satisfies ${label}`
    });
};
/** Renders a decision as plain lines, from its value alone. */
export const lines = (decision) => decision.steps.map(liner(decision.decider));
const isProblem = (error) => error instanceof Problem;
const tell = Effect.fnUntraced(function* (decision, backend) {
    const { decider, title } = decision;
    const line = liner(decider);
    const the = checks(decider);
    const touch = caser(decider);
    const touched = yield* Ref.make([]);
    const note = (cases) => Ref.update(touched, (all) => [...all, ...cases]);
    const eventsKey = (events) => Effect.map(Effect.forEach(events, the.event.key), JSON.stringify);
    const eventLines = (events) => events.map(the.event.show).join('\n');
    const unanswered = 'a when needs accepted(...) or rejected(...) right after it';
    const fail = (entry) => (problem) => located(decision, new StoryFailure({
        title,
        step: entry.no,
        line: entry.line,
        problem: problem.message,
        expected: problem.expected,
        actual: problem.actual
    }));
    const answer = (decided, name, compare) => Option.match(decided, {
        onNone: () => Effect.fail(new Problem({ message: `${name}(...) comes right after a when` })),
        onSome: (result) => Effect.as(compare(result), Option.none())
    });
    const current = (check) => Effect.flatMap(backend.current, check);
    const same = (expected, message) => Effect.andThen(the.state.valid(expected), current((actual) => Effect.flatMap(Effect.all([the.state.key(expected), the.state.key(actual)]), ([wanted, got]) => wanted === got
        ? Effect.void
        : Effect.fail(new Problem({
            message,
            expected: the.state.show(expected),
            actual: the.state.show(actual)
        })))));
    const step = (index, decided, next) => Option.isSome(decided) && !Step.$is('Accepted')(next) && !Step.$is('Rejected')(next)
        ? Effect.fail(new Problem({ message: unanswered }))
        : Step.$match(next, {
            Given: ({ state: start }) => index === 0
                ? Effect.as(backend
                    .start(start)
                    .pipe(Effect.andThen(same(start, 'the stored state differs from given')), Effect.andThen(note(touch.state(start)))), Option.none())
                : Effect.fail(new Problem({ message: 'given(state) comes once, first' })),
            When: ({ command }) => Effect.flatMap(backend.decide(command), (ruled) => Effect.as(note(touch.ruled(command, ruled)), Option.some(ruled.decided))),
            Accepted: ({ events }) => answer(decided, 'accepted', (result) => Effect.andThen(Effect.forEach(events, the.event.valid), Result.match(result, {
                onFailure: (rejection) => Effect.fail(new Problem({
                    message: 'the command was rejected',
                    expected: eventLines(events),
                    actual: the.rejection.show(rejection)
                })),
                onSuccess: (actual) => Effect.flatMap(Effect.all([eventsKey(events), eventsKey(actual)]), ([wanted, got]) => wanted === got
                    ? Effect.void
                    : Effect.fail(new Problem({
                        message: 'the events differ',
                        expected: eventLines(events),
                        actual: eventLines(actual)
                    })))
            }))),
            Rejected: ({ rejection }) => answer(decided, 'rejected', (result) => Effect.andThen(the.rejection.valid(rejection), Result.match(result, {
                onFailure: (actual) => Effect.flatMap(Effect.all([the.rejection.key(rejection), the.rejection.key(actual)]), ([wanted, got]) => wanted === got
                    ? Effect.void
                    : Effect.fail(new Problem({
                        message: 'the rejection differs',
                        expected: the.rejection.show(rejection),
                        actual: the.rejection.show(actual)
                    }))),
                onSuccess: (events) => Effect.fail(new Problem({
                    message: 'the command was accepted',
                    expected: the.rejection.show(rejection),
                    actual: eventLines(events)
                }))
            }))),
            State: ({ expected }) => Effect.as(same(expected, 'the state differs'), decided),
            Satisfies: ({ label, check }) => Effect.as(current((actual) => the.state.satisfies(actual, label, check)), decided)
        });
    const [first] = decision.steps;
    if (!Step.$is('Given')(first)) {
        return yield* fail({ no: 1, line: first === undefined ? '' : line(first) })(new Problem({ message: 'a decision starts with given(state)' }));
    }
    /** Fails a Problem as a StoryFailure at `entry`; other errors pass through. */
    const at = (entry) => (effect) => Effect.catchIf(effect, isProblem, (problem) => Effect.fail(fail(entry)(problem)));
    let decided = Option.none();
    for (const [index, next] of decision.steps.entries()) {
        decided = yield* step(index, decided, next).pipe(at({ no: index + 1, line: line(next) }));
    }
    const end = { no: decision.steps.length + 1, line: 'end' };
    if (Option.isSome(decided)) {
        return yield* fail(end)(new Problem({ message: unanswered }));
    }
    const reached = yield* backend.current.pipe(at(end));
    return {
        state: reached,
        final: the.state.show(reached),
        cases: Arr.dedupe(yield* Ref.get(touched)).toSorted()
    };
});
/** Keeps the state in memory. */
const memory = Effect.fnUntraced(function* (decider) {
    const rules = strict(decider);
    const stored = yield* Ref.make(decider.initial);
    const backend = {
        start: (first) => Effect.flatMap(rules.check(first), (copy) => Ref.set(stored, copy)),
        decide: (command) => Effect.tap(Effect.flatMap(Ref.get(stored), (current) => rules.rule(current, command)), ({ reached }) => Ref.set(stored, reached)),
        current: Ref.get(stored)
    };
    return backend;
});
/** Runs a decision in memory: every step and every strict rule. */
export const run = (decision) => Effect.flatMap(memory(decision.decider), (backend) => tell(decision, backend));
/**
 * Runs a decision through `handle`'s transaction on a real Store, under `key`, with every strict
 * rule. The test arranges the Store beforehand: `given` loads the state under `key` (or `initial`)
 * and fails unless it equals the given state. Each `when` decides and saves, and `state` loads and
 * checks what the Store gives back. Store errors fail as they are.
 */
export const against = (decision, Store, key) => Effect.flatMap(Store, (store) => {
    const rules = strict(decision.decider);
    const decide = decideIn(decision.decider, store, rules.rule);
    return tell(decision, {
        start: () => Effect.void,
        decide: (command) => decide(key, command),
        current: Effect.flatMap(loadOrInitial(decision.decider, store, key), rules.check)
    });
});
//# sourceMappingURL=Decision.js.map