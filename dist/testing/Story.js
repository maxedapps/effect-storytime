/**
 * A story tells how a Program behaves, as steps: start from a model, send messages, and account
 * for every command it asks for. Running it checks each step and the strict rules in between.
 */
import { Array as Arr, Data, Effect, Option, Schema } from 'effect';
import { shower } from '../internal/canonical.js';
import { Problem } from './internal/check.js';
import { line, say, Step as StepSchema } from './internal/steps.js';
import { machine } from './internal/machine.js';
import { located, made, TypeId } from './internal/tale.js';
const Step = Data.taggedEnum();
/** The step builders for stories about `program`; only its types matter. */
export const of = (_program) => ({
    given: (model) => Step.Given({ model }),
    send: (message) => Step.Send({ message }),
    model: (expected) => Step.Model({ expected }),
    satisfies: (label, check) => Step.Satisfies({ label, check }),
    commands: (...expected) => Step.Commands({ commands: expected }),
    resolve: (command, reply) => Step.Resolve({ command, reply: Option.fromUndefinedOr(reply) }),
    emit: (command, message) => Step.Emit({ command, message }),
    restart: () => Step.Restart(),
    anyOrder: (...steps) => Step.AnyOrder({ steps }),
    steps: (...grouped) => Step.Group({ steps: grouped })
});
export class Story extends Data.TaggedClass('Story') {
    [TypeId]() {
        return { subject: this.program, steps: told(this), run: run(this) };
    }
}
export const make = (title, program, ...body) => made(new Story({ title, program, steps: body }), make);
/**
 * A failed tale, with the step (its line number in `lines`) where it failed. Its message tells all
 * of it but a differing `expected` and `actual`, which test runners diff, and its stack starts at
 * the call that made the tale. A failed exploration also carries its counterexample, as steps and
 * as the code that makes it.
 */
export class StoryFailure extends Schema.TaggedError()('StoryFailure', {
    title: Schema.String,
    step: Schema.Int,
    line: Schema.String,
    problem: Schema.String,
    expected: Schema.optional(Schema.String),
    actual: Schema.optional(Schema.String),
    counterexample: Schema.optional(Schema.Array(StepSchema)),
    replay: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String)
}) {
    get message() {
        const { step, line: at, expected, actual, counterexample, replay, code } = this;
        const where = counterexample === undefined
            ? [`step ${step}: ${at}`]
            : [
                at,
                `step ${step} of the counterexample:`,
                ...counterexample.map((told, index) => `${index + 1 === step ? '>' : ' '} ${index + 1} ${line(told)}`)
            ];
        return [
            this.problem,
            ...where,
            ...(expected === undefined && actual !== undefined
                ? [`actual: ${actual.replaceAll('\n', '\n  ')}`]
                : []),
            ...(replay === undefined ? [] : [`replay: ${replay}`]),
            ...(code === undefined ? [] : ['as code:', code])
        ].join('\n');
    }
}
const layout = (program, body) => {
    const model = shower(program.Model);
    const message = shower(program.Message);
    const command = shower(program.Command);
    let next = 1;
    const place = (depth, group) => group.map((step) => {
        const entry = (verb, values, label) => {
            const data = say(verb, depth, values, label);
            return { no: next++, data: Option.some(data), line: line(data), step, children: [] };
        };
        return Step.$match(step, {
            Given: ({ model: start }) => entry('given', [model(start)]),
            Send: ({ message: sent }) => entry('send', [message(sent)]),
            Model: ({ expected }) => entry('model', [model(expected)]),
            Satisfies: ({ label }) => entry('satisfies', [], label),
            Commands: ({ commands: expected }) => entry('commands', expected.map(command)),
            Resolve: ({ command: done, reply }) => entry('resolve', [command(done), ...Option.toArray(Option.map(reply, message))]),
            Emit: ({ command: running, message: sent }) => entry('emit', [command(running), message(sent)]),
            Restart: () => entry('restart', []),
            // The `anyOrder` takes its number before the steps inside it.
            AnyOrder: ({ steps: units }) => ({
                ...entry('any order', []),
                children: place(depth + 1, units)
            }),
            Group: ({ steps: inner }) => ({
                no: next,
                data: Option.none(),
                // Stryker disable next-line StringLiteral: a group has no line of its own, so none shows it
                line: '',
                step,
                children: place(depth, inner)
            })
        });
    });
    return place(0, body);
};
/** Every entry that says something, in story order. */
const flatten = (entries) => entries.flatMap((entry) => Step.$is('Group')(entry.step) ? flatten(entry.children) : [entry, ...flatten(entry.children)]);
/** What a story says, step by step, from its value alone. */
const told = (story) => flatten(layout(story.program, story.steps)).flatMap((entry) => Option.toArray(entry.data));
/** Renders a story as plain lines, from its value alone. */
export const lines = (story) => told(story).map(line);
/**
 * The step numbers of `units` as they run: a group's own steps, and an `anyOrder` once, by its
 * line, since its own order follows.
 */
const numbers = (units) => units.flatMap((entry) => (Step.$is('Group')(entry.step) ? numbers(entry.children) : [entry.no]));
const permutations = (items) => Arr.match(items, {
    onEmpty: () => [[]],
    onNonEmpty: (some) => Arr.flatMap(some, (item, index) => Arr.map(permutations(Arr.remove(some, index)), (rest) => [item, ...rest]))
});
/** Runs a story: every step and every strict rule, once per order of each `anyOrder`. */
export const run = Effect.fnUntraced(function* (story) {
    const { program, title } = story;
    const entries = layout(program, story.steps);
    const all = flatten(entries);
    const rules = machine(program);
    const fail = (entry, order) => (problem) => located(story, new StoryFailure({
        title,
        step: entry.no,
        line: entry.line,
        problem: `${order.length === 0 ? '' : `in order ${order.join(', ')}: `}${problem.message}`,
        expected: problem.expected,
        actual: problem.actual
    }));
    const end = { no: all.length + 1, line: 'end' };
    const finish = ({ state, order }) => {
        const owed = state.pending.filter((entry) => entry.owed);
        return owed.length === 0
            ? Effect.void
            : Effect.fail(fail(end, order)(new Problem({
                message: `the story ended with ${owed.length} unasserted command(s)`,
                actual: rules.pendingLines(owed)
            })));
    };
    const [first] = all;
    /** Runs `queue` from `state`, once per order of every `anyOrder` in it. */
    const go = (state, queue, order) => {
        const [head, ...rest] = queue;
        if (head === undefined)
            return Effect.succeed(Arr.of({ state, order }));
        const then = (next) => next.pipe(Effect.mapError(fail(head, order)), Effect.flatMap((reached) => go(reached, rest, order)));
        return Step.$match(head.step, {
            Given: () => head === first
                ? go(state, rest, order)
                : then(Effect.fail(new Problem({ message: 'given(model) comes once, first' }))),
            Send: ({ message }) => then(rules.send(state, message)),
            Model: ({ expected }) => then(rules.model(state, expected)),
            Satisfies: ({ label, check }) => then(rules.satisfies(state, label, check)),
            Commands: ({ commands: expected }) => then(rules.commands(state, expected)),
            Resolve: ({ command, reply }) => then(rules.resolve(state, command, reply)),
            Emit: ({ command, message }) => then(rules.emit(state, command, message)),
            Restart: () => then(rules.restart(state)),
            // Each order runs with its own cancellations, whose replies it skips; the rest runs after
            // each order with the cancellations from before it.
            AnyOrder: () => Effect.map(Effect.forEach(permutations(head.children), (units) => Effect.flatMap(go({
                ...state,
                // Stryker disable next-line ArrayDeclaration: no command has an unknown key, so it never matches
                cancelled: Option.orElseSome(state.cancelled, () => [])
            }, units, [...order, ...numbers(units)]), (orders) => Effect.forEach(orders, (reached) => go({ ...reached.state, cancelled: state.cancelled }, rest, reached.order)))), (each) => Arr.flatten(Arr.flatten(each))),
            Group: () => go(state, [...head.children, ...rest], order)
        });
    };
    if (first === undefined || !Step.$is('Given')(first.step)) {
        return yield* fail(first ?? { no: 1, line: '' }, [])(new Problem({ message: 'a story starts with given(model)' }));
    }
    const crowded = all.find((entry) => Step.$is('AnyOrder')(entry.step) && (entry.children.length < 2 || entry.children.length > 5));
    if (crowded) {
        return yield* fail(crowded, [])(new Problem({ message: 'anyOrder takes 2 to 5 steps' }));
    }
    const initial = yield* Effect.mapError(rules.start(first.step.model), fail(first, []));
    const reached = yield* go(initial, entries, []);
    yield* Effect.forEach(reached, finish);
    const show = shower(program.Model);
    return {
        finals: Arr.map(reached, ({ state, order }) => ({
            order,
            model: state.model,
            final: show(state.model)
        })),
        cases: Arr.dedupe(reached.flatMap(({ state }) => state.cases)).toSorted()
    };
});
//# sourceMappingURL=Story.js.map