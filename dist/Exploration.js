/**
 * An exploration generates stories instead of telling one: random paths of messages, command
 * answers and restarts through a Program, each checked with every strict rule a story runs except
 * command assertions. A failing path shrinks to a short story, its counterexample.
 */
import { Arbitrary, Array as Arr, Data, Effect, Match, Option, Predicate, Ref, Schema } from 'effect';
import { machine } from './internal/machine.js';
import { TypeId } from './internal/tale.js';
import * as Story from './Story.js';
export class Exploration extends Data.TaggedClass('Exploration') {
    [TypeId]() {
        return { lines: lines(this), run: check(this) };
    }
}
const nothing = () => [];
export const make = (title, program, options) => new Exploration({
    title,
    program,
    replies: nothing,
    emits: nothing,
    restarts: true,
    runs: 100,
    steps: 30,
    seed: title,
    ...options,
    // Derived only when needed, since not every Message Schema has an Arbitrary.
    send: options.send ?? Arbitrary.schema(program.Message)
});
const summary = (exploration) => `explore ${exploration.runs} runs of up to ${exploration.steps} steps, seed ${JSON.stringify(exploration.seed)}${exploration.restarts ? ', with restarts' : ''}`;
/** Renders an exploration as its one line; a failure's counterexample is a story's lines. */
export const lines = (exploration) => [summary(exploration)];
const Action = Data.taggedEnum();
const index = Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)));
const paths = (exploration) => {
    const kinds = Schema.Literals(exploration.restarts ? ['Send', 'Reply', 'Restart'] : ['Send', 'Reply']);
    const action = Arbitrary.flatMap(Arbitrary.schema(kinds), (kind) => ({
        Send: Arbitrary.map(exploration.send, (message) => Action.Send({ message })),
        Reply: Arbitrary.map(Arbitrary.all({ pick: index, choice: index }), Action.Reply),
        Restart: Arbitrary.Constant(Action.Restart())
    })[kind]);
    return Arbitrary.all({ start: exploration.given, actions: Arbitrary.array(action) });
};
/** Where a path broke a rule, before the check knows the replay that reproduces it. */
class Broken extends Data.Error {
}
/** Walks a path, turning each action into a story step, and gives the cases it reached. */
const walker = (exploration) => {
    const { title, program } = exploration;
    const rules = machine(program, false);
    /** Answers the pending command at `pick` with its reply or stream message at `choice`. */
    const reply = (state, pick, choice) => Arr.match(state.pending, {
        onEmpty: Option.none,
        onNonEmpty: (pending) => Option.flatMap(Arr.get(pending, pick % pending.length), ({ command }) => Arr.match([
            ...exploration
                .replies(command)
                .map((message) => [
                Story.resolve(command, message),
                rules.resolve(state, command, Option.some(message))
            ]),
            ...exploration
                .emits(command)
                .map((message) => [
                Story.emit(command, message),
                rules.emit(state, command, message)
            ])
        ], {
            onEmpty: Option.none,
            onNonEmpty: (answers) => Arr.get(answers, choice % answers.length)
        }))
    });
    const moved = (step, effect) => Option.some([step, effect]);
    const move = (state, action) => Action.$match(action, {
        Send: ({ message }) => moved(Story.send(message), rules.send(state, message)),
        Reply: ({ pick, choice }) => reply(state, pick, choice),
        Restart: () => moved(Story.restart(), rules.restart(state))
    });
    return Effect.fnUntraced(function* (path) {
        const told = [Story.given(path.start)];
        const broken = (problem) => new Broken({
            step: told.length,
            problem,
            counterexample: Story.lines(Story.make(title, program, ...told))
        });
        let state = yield* Effect.mapError(rules.start(path.start), broken);
        for (const action of path.actions) {
            const next = move(state, action);
            if (Option.isSome(next)) {
                const [step, effect] = next.value;
                told.push(step);
                state = yield* Effect.mapError(effect, broken);
            }
        }
        return state.cases;
    });
};
/**
 * Checks `runs` generated paths. A failure carries the shrunk path as a story's lines, its
 * counterexample, with `step` numbering the line that failed, and a `replay` token that checks
 * just that path again.
 */
export const check = Effect.fnUntraced(function* (exploration, options) {
    const { title } = exploration;
    const walk = walker(exploration);
    const seen = yield* Ref.make([]);
    const result = yield* Arbitrary.checkEffect(paths(exploration), (path) => walk(path).pipe(Effect.flatMap((cases) => Ref.update(seen, (all) => Arr.dedupe([...all, ...cases]))), Effect.as(true)), {
        runs: exploration.runs,
        size: exploration.steps,
        seed: exploration.seed,
        replay: options?.replay
    });
    const line = summary(exploration);
    return yield* Match.value(result).pipe(Match.tag('Passed', ({ runs }) => Effect.map(Ref.get(seen), (cases) => ({ runs, cases: cases.toSorted() }))), 
    // Every path passes or fails, so a property error is the only way a path is falsified.
    Match.when({ failure: Predicate.isTagged('PropertyError') }, ({ failure: { error }, replay }) => Effect.fail(new Story.StoryFailure({
        title,
        step: error.step,
        line,
        message: error.problem.message,
        expected: error.problem.expected,
        actual: error.problem.actual,
        counterexample: error.counterexample,
        replay
    }))), Match.orElse((unfinished) => Effect.fail(new Story.StoryFailure({
        title,
        step: 1,
        line,
        message: String(Arbitrary.formatCheckFailure(unfinished))
    }))));
});
//# sourceMappingURL=Exploration.js.map