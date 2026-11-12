/**
 * A story tells how a Program behaves, as steps: start from a model, send messages, and account
 * for every command it asks for. Running it checks each step and the strict rules in between.
 */
import { Array as Arr, Data, Effect, Option, Schema } from 'effect';
import { describer } from '../internal/canonical.js';
import { Problem } from './internal/check.js';
import { machine } from './internal/machine.js';
import { TypeId } from './internal/tale.js';
const Step = Data.taggedEnum();
/** Starts the story from a model. It comes first and only once. */
export const given = (model) => Step.Given({ model });
/** Sends a message through `update`. */
export const send = (message) => Step.Send({ message });
/** Requires the model to equal `expected`. */
export const model = (expected) => Step.Model({ expected });
/** Requires the model to pass a check, shown in story lines by its label. */
export const satisfies = (label, check) => Step.Satisfies({ label, check });
/** Requires exactly these commands to be pending, in any order; `commands()` means none. */
export const commands = (...expected) => Step.Commands({ commands: expected });
/** Completes a pending command and feeds its reply, if it has one, through `update`. */
export const resolve = (command, reply) => Step.Resolve({ command, reply: Option.fromUndefinedOr(reply) });
/** Feeds one message from a pending streaming command, which stays pending. */
export const emit = (command, message) => Step.Emit({ command, message });
/**
 * Restarts as after a crash: the model goes through JSON, every pending command is dropped and
 * `resume` decides what to redo.
 */
export const restart = () => Step.Restart();
/**
 * Runs the rest of the story once per order of these 2 to 5 steps. A `resolve` or `emit` is
 * skipped when its command was cancelled earlier in the same order.
 */
export const anyOrder = (...steps) => Step.AnyOrder({ steps });
/** Groups steps, so a story can share a common part. */
export const steps = (...grouped) => Step.Group({ steps: grouped });
export class Story extends Data.TaggedClass('Story') {
    [TypeId]() {
        return { subject: this.program, lines: lines(this), run: run(this) };
    }
}
export const make = (title, program, ...body) => new Story({ title, program, steps: body });
/** A failed story, with the step (its line number in `lines`) where it failed. */
export class StoryFailure extends Schema.TaggedError()('StoryFailure', {
    title: Schema.String,
    step: Schema.Int,
    line: Schema.String,
    message: Schema.String,
    expected: Schema.optional(Schema.String),
    actual: Schema.optional(Schema.String),
    counterexample: Schema.optional(Schema.Array(Schema.String)),
    replay: Schema.optional(Schema.String)
}) {
}
const layout = (program, body) => {
    const showModel = describer(program.Model);
    const showMessage = describer(program.Message);
    const showCommand = describer(program.Command);
    let next = 1;
    const place = (depth, group) => group.map((step) => {
        const leaf = (line) => ({ no: next++, depth, line, step, children: [] });
        return Step.$match(step, {
            Given: ({ model: start }) => leaf(`given ${showModel(start)}`),
            Send: ({ message }) => leaf(`send ${showMessage(message)}`),
            Model: ({ expected }) => leaf(`model ${showModel(expected)}`),
            Satisfies: ({ label }) => leaf(`satisfies ${label}`),
            Commands: ({ commands: expected }) => leaf(`commands ${expected.length === 0 ? 'none' : expected.map(showCommand).join(', ')}`),
            Resolve: ({ command, reply }) => leaf(`resolve ${showCommand(command)}${Option.match(reply, {
                onNone: () => '',
                onSome: (message) => ` → ${showMessage(message)}`
            })}`),
            Emit: ({ command, message }) => leaf(`emit ${showCommand(command)} → ${showMessage(message)}`),
            Restart: () => leaf('restart'),
            AnyOrder: ({ steps: units }) => ({
                no: next++,
                depth,
                line: 'any order',
                step,
                children: place(depth + 1, units)
            }),
            Group: ({ steps: inner }) => ({
                no: next,
                depth,
                // Stryker disable next-line StringLiteral: a group has no line of its own, so none shows it
                line: '',
                step,
                children: place(depth, inner)
            })
        });
    });
    return place(0, body);
};
/** Every entry that has a line, in story order. */
const flatten = (entries) => entries.flatMap((entry) => Step.$is('Group')(entry.step) ? flatten(entry.children) : [entry, ...flatten(entry.children)]);
/** Renders a story as plain lines, from its value alone. */
export const lines = (story) => flatten(layout(story.program, story.steps)).map((entry) => `${'  '.repeat(entry.depth)}${entry.line}`);
const permutations = (items) => Arr.match(items, {
    onEmpty: () => [[]],
    onNonEmpty: (some) => Arr.flatMap(some, (item, index) => Arr.map(permutations(Arr.remove(some, index)), (rest) => [item, ...rest]))
});
/** Runs a story: every step and every strict rule, once per order of each `anyOrder`. */
export const run = Effect.fnUntraced(function* (story) {
    const { program, title } = story;
    const entries = layout(program, story.steps);
    const all = flatten(entries);
    const rules = machine(program, true);
    const fail = (entry, order) => (problem) => new StoryFailure({
        title,
        step: entry.no,
        line: entry.line,
        message: `${order}${problem.message}`,
        expected: problem.expected,
        actual: problem.actual
    });
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
            }, units, `${order}in order ${flatten(units)
                .map((entry) => entry.no)
                .join(', ')}: `), (orders) => Effect.forEach(orders, (reached) => go({ ...reached.state, cancelled: state.cancelled }, rest, reached.order)))), (each) => Arr.flatten(Arr.flatten(each))),
            Group: () => go(state, [...head.children, ...rest], order)
        });
    };
    if (first === undefined || !Step.$is('Given')(first.step)) {
        return yield* fail(first ?? { no: 1, line: '' }, '')(new Problem({ message: 'a story starts with given(model)' }));
    }
    const crowded = all.find((entry) => Step.$is('AnyOrder')(entry.step) && (entry.children.length < 2 || entry.children.length > 5));
    if (crowded) {
        return yield* fail(crowded, '')(new Problem({ message: 'anyOrder takes 2 to 5 steps' }));
    }
    const initial = yield* Effect.mapError(rules.start(first.step.model), fail(first, ''));
    const reached = yield* go(initial, entries, '');
    yield* Effect.forEach(reached, finish);
    const [{ state: final }] = reached;
    return {
        model: final.model,
        final: describer(program.Model)(final.model),
        cases: Arr.dedupe(reached.flatMap(({ state }) => state.cases)).toSorted()
    };
});
//# sourceMappingURL=Story.js.map