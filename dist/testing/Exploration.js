/**
 * An exploration generates tales instead of telling one: random paths of messages, command answers
 * and restarts through a Program, or of commands through a Decider, each checked with every strict
 * rule a story or decision runs except command assertions, plus the exploration's own named
 * properties. A failing path shrinks to a short tale, its counterexample.
 */
import { Arbitrary, Array as Arr, Data, Effect, Match, Option, Predicate, Ref, Schema } from 'effect';
import * as Decision from './Decision.js';
import { attempt, Broken } from './internal/check.js';
import { caser, strict } from './internal/decider.js';
import { machine } from './internal/machine.js';
import { located, made, TypeId } from './internal/tale.js';
import * as Story from './Story.js';
export class Exploration extends Data.TaggedClass('Exploration') {
    [TypeId]() {
        return { subject: this.subject, lines: lines(this), run: check(this) };
    }
}
const settled = (title, settings) => ({
    runs: settings.runs ?? 100,
    steps: settings.steps ?? 30,
    seed: settings.seed ?? title
});
const nothing = () => [];
/** Explores a Program: paths of sent messages, command answers and restarts from a given model. */
export const make = (title, program, options) => {
    const restarts = options.restarts ?? true;
    const exploration = new Exploration({
        title,
        subject: program,
        ...settled(title, options),
        restarts,
        walks: Arbitrary.map(paths(options.given, 
        // Derived only when needed, since not every Message Schema has an Arbitrary.
        options.send ?? Arbitrary.schema(program.Message), restarts), walker(title, program, options))
    });
    return made(exploration, make);
};
/** Explores a Decider: paths of commands decided one after another from a given state. */
export const decisions = (title, decider, options = {}) => made(new Exploration({
    title,
    subject: decider,
    ...settled(title, options),
    restarts: false,
    walks: Arbitrary.map(Arbitrary.all({
        start: options.given ?? Arbitrary.Constant(decider.initial),
        commands: Arbitrary.array(options.when ?? Arbitrary.schema(decider.Command))
    }), deciderWalker(title, decider, options.properties))
}), decisions);
const summary = (exploration) => `explore ${exploration.runs} runs of up to ${exploration.steps} steps, seed ${JSON.stringify(exploration.seed)}${exploration.restarts ? ', with restarts' : ''}`;
/** Renders an exploration as its one line; a failure's counterexample is a tale's lines. */
export const lines = (exploration) => [summary(exploration)];
const Action = Data.taggedEnum();
const index = Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)));
const paths = (given, send, restarts) => {
    const kinds = Schema.Literals(restarts ? ['Send', 'Reply', 'Restart'] : ['Send', 'Reply']);
    const action = Arbitrary.flatMap(Arbitrary.schema(kinds), (kind) => ({
        Send: Arbitrary.map(send, (message) => Action.Send({ message })),
        Reply: Arbitrary.map(Arbitrary.all({ pick: index, choice: index }), Action.Reply),
        Restart: Arbitrary.Constant(Action.Restart())
    })[kind]);
    return Arbitrary.all({ start: given, actions: Arbitrary.array(action) });
};
/** Walks a Program's path, turning each action into a story step, and gives the cases it reached. */
const walker = (title, program, options) => {
    const { replies = nothing, emits = nothing } = options;
    const rules = machine(program, false, options.properties);
    const story = Story.of(program);
    /** The replies and stream messages of a command; a throwing callback is a Problem. */
    const answers = Effect.fnUntraced(function* (state, command) {
        const replied = yield* attempt('replies', () => replies(command));
        const emitted = yield* attempt('emits', () => emits(command));
        return [
            ...replied.map((message) => [
                story.resolve(command, message),
                rules.resolve(state, command, Option.some(message))
            ]),
            ...emitted.map((message) => [
                story.emit(command, message),
                rules.emit(state, command, message)
            ])
        ];
    });
    /**
     * Answers the pending command at `pick` with its reply or stream message at `choice`. With none
     * to pick from, the index is `NaN`, which `Arr.get` finds nothing at.
     */
    const reply = (state, pick, choice) => Option.match(Arr.get(state.pending, pick % state.pending.length), {
        onNone: () => Effect.succeedNone,
        onSome: ({ command }) => Effect.map(answers(state, command), (moves) => Arr.get(moves, choice % moves.length))
    });
    const moved = (step, effect) => Effect.succeedSome([step, effect]);
    const move = (state, action) => Action.$match(action, {
        Send: ({ message }) => moved(story.send(message), rules.send(state, message)),
        Reply: ({ pick, choice }) => reply(state, pick, choice),
        Restart: () => moved(story.restart(), rules.restart(state))
    });
    return Effect.fnUntraced(function* (path) {
        const told = [story.given(path.start)];
        const broken = (problem) => new Broken({
            step: told.length,
            problem,
            counterexample: Story.lines(Story.make(title, program, ...told))
        });
        let state = yield* Effect.mapError(rules.start(path.start), broken);
        for (const action of path.actions) {
            const next = yield* Effect.mapError(move(state, action), broken);
            if (Option.isSome(next)) {
                const [step, effect] = next.value;
                told.push(step);
                state = yield* Effect.mapError(effect, broken);
            }
        }
        return state.cases;
    });
};
/** Walks a Decider's path, turning each command into a `when`, and gives the cases it touched. */
const deciderWalker = (title, decider, properties) => {
    const rules = strict(decider, properties);
    const touch = caser(decider);
    const decision = Decision.of(decider);
    return Effect.fnUntraced(function* (path) {
        const told = [
            decision.given(path.start)
        ];
        const broken = (problem) => new Broken({
            step: told.length,
            problem,
            counterexample: Decision.lines(Decision.make(title, decider, ...told))
        });
        let state = yield* Effect.mapError(rules.check(path.start), broken);
        const cases = [...touch.state(state)];
        for (const command of path.commands) {
            told.push(decision.when(command));
            const ruled = yield* Effect.mapError(rules.rule(state, command), broken);
            cases.push(...touch.ruled(command, ruled));
            state = ruled.reached;
        }
        return cases;
    });
};
/**
 * Checks `runs` generated paths. A failure carries the shrunk path as a story's lines, its
 * counterexample, with `step` numbering the line that failed, and a `replay` token that checks
 * just that path again.
 */
export const check = Effect.fnUntraced(function* (exploration, options) {
    const { title } = exploration;
    const seen = yield* Ref.make([]);
    const result = yield* Arbitrary.checkEffect(exploration.walks, (walk) => walk.pipe(Effect.flatMap((cases) => Ref.update(seen, (all) => Arr.dedupe([...all, ...cases]))), Effect.as(true)), {
        runs: exploration.runs,
        size: exploration.steps,
        seed: exploration.seed,
        replay: options?.replay
    });
    const line = summary(exploration);
    return yield* Match.value(result).pipe(Match.tag('Passed', ({ runs }) => Effect.map(Ref.get(seen), (cases) => ({ runs, cases: cases.toSorted() }))), 
    // Every path passes or fails, so a property error is the only way a path is falsified.
    Match.when({ failure: Predicate.isTagged('PropertyError') }, ({ failure: { error }, replay }) => Effect.fail(located(exploration, new Story.StoryFailure({
        title,
        step: error.step,
        line,
        problem: error.problem.message,
        expected: error.problem.expected,
        actual: error.problem.actual,
        counterexample: error.counterexample,
        replay
    })))), Match.orElse((unfinished) => Effect.fail(located(exploration, new Story.StoryFailure({
        title,
        step: 1,
        line,
        problem: String(Arbitrary.formatCheckFailure(unfinished))
    })))));
});
//# sourceMappingURL=Exploration.js.map