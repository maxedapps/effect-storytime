/**
 * An exploration generates tales instead of telling one: random paths of messages, command answers
 * and restarts through a Program, or of commands through a Decider, each checked with every strict
 * rule a story or decision runs except command assertions, plus the exploration's own named
 * properties. A failing path shrinks to a short tale, its counterexample.
 */
import { Arbitrary, Array as Arr, Config, Data, Effect, Match, Option, Predicate, Random, Ref, Result, Schema } from 'effect';
import * as Decision from './Decision.js';
import { attempt, Broken } from './internal/check.js';
import { code } from './internal/code.js';
import { caser, strict } from './internal/decider.js';
import { machine } from './internal/machine.js';
import { line, say } from './internal/steps.js';
import { located, made, TypeId } from './internal/tale.js';
import * as Story from './Story.js';
import * as Tale from './Tale.js';
export class Exploration extends Data.TaggedClass('Exploration') {
    [TypeId]() {
        return { subject: this.subject, steps: [said(this)], run: check(this) };
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
/** An exploration's one step: `explore` with the settings it runs with. */
const said = ({ runs, steps, seed, restarts }) => say('explore', 0, [], `${runs} runs of up to ${steps} steps, seed ${JSON.stringify(seed)}${restarts ? ', with restarts' : ''}`);
/** Renders an exploration as its one line; a failure's counterexample is a tale's steps. */
export const lines = (exploration) => [line(said(exploration))];
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
    const rules = machine(program, options.properties);
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
            counterexample: Story.make(title, program, ...told)
        });
        let state = yield* Effect.mapError(rules.start(path.start), broken);
        for (const action of path.actions) {
            const next = yield* Effect.mapError(move(state, action), broken);
            if (Option.isSome(next)) {
                const [step, effect] = next.value;
                told.push(step);
                state = yield* Effect.mapError(effect, broken);
                // Asserts what the step produced, so the path runs as a story.
                if (state.pending.some((entry) => entry.owed)) {
                    const pending = state.pending.map((entry) => entry.command);
                    told.push(story.commands(...pending));
                    state = yield* Effect.mapError(rules.commands(state, pending), broken);
                }
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
            counterexample: Decision.make(title, decider, ...told)
        });
        let state = yield* Effect.mapError(rules.check(path.start), broken);
        const cases = [...touch.state(state)];
        for (const command of path.commands) {
            told.push(decision.when(command));
            const ruled = yield* Effect.mapError(rules.rule(state, command), broken);
            // Names what the command gave, so the path runs as a decision.
            told.push(Result.match(ruled.decided, {
                onSuccess: (events) => decision.accepted(...events),
                onFailure: decision.rejected
            }));
            yield* Effect.mapError(rules.holds({ before: state, command, decided: ruled.decided, after: ruled.reached }), broken);
            cases.push(...touch.ruled(command, ruled));
            state = ruled.reached;
        }
        return cases;
    });
};
/**
 * Overrides of every exploration's settings when it is checked, read through `Config`: from the
 * environment unless another `ConfigProvider` is given. `STORYTIME_SEED` is `random`, a fresh seed
 * for each check, or the integer seed a failure printed; `STORYTIME_RUNS` is how many paths to check.
 */
const overrides = Config.all({
    seed: Config.option(Config.schema(Schema.Union([Schema.Literal('random'), Schema.Int]), 'STORYTIME_SEED')),
    runs: Config.option(Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), 'STORYTIME_RUNS'))
});
/** The seed to check with: the override's, a fresh one for `random`, or the exploration's own. */
const seeded = (exploration, seed) => Option.match(seed, {
    onNone: () => Effect.succeed(exploration.seed),
    onSome: (chosen) => (chosen === 'random' ? Random.nextInt : Effect.succeed(chosen))
});
/** The paths to check, with the line naming them: the overrides over the exploration's settings. */
const generated = Effect.fnUntraced(function* (exploration) {
    const chosen = yield* Effect.orDie(overrides);
    const runs = Option.getOrElse(chosen.runs, () => exploration.runs);
    const seed = yield* seeded(exploration, chosen.seed);
    const { steps, restarts } = exploration;
    return { ran: line(said({ runs, steps, seed, restarts })), runs, size: steps, seed };
});
/**
 * Checks `runs` generated paths, or as many as `STORYTIME_RUNS` says, from the exploration's seed or
 * `STORYTIME_SEED`'s; an invalid override dies. A failure carries the shrunk path as a story's or decision's steps, its
 * counterexample, with `step` numbering the step that failed, the code that makes it, and a
 * `replay` token that checks just that path again. A replay checks only the token's path, so its line is the token.
 */
export const check = Effect.fnUntraced(function* (exploration, options) {
    const { title } = exploration;
    const token = options?.replay;
    const { ran, ...settings } = token === undefined ? yield* generated(exploration) : { ran: `replay ${token}`, replay: token };
    const seen = yield* Ref.make([]);
    const result = yield* Arbitrary.checkEffect(exploration.walks, (walk) => walk.pipe(Effect.flatMap((cases) => Ref.update(seen, (all) => Arr.dedupe([...all, ...cases]))), Effect.as(true)), settings);
    return yield* Match.value(result).pipe(Match.tag('Passed', ({ runs }) => Effect.map(Ref.get(seen), (cases) => ({ runs, cases: cases.toSorted() }))), 
    // Every path passes or fails, so a property error is the only way a path is falsified.
    Match.when({ failure: Predicate.isTagged('PropertyError') }, ({ failure: { error }, replay }) => Effect.fail(located(exploration, new Story.StoryFailure({
        title,
        step: error.step,
        line: ran,
        problem: error.problem.message,
        expected: error.problem.expected,
        actual: error.problem.actual,
        counterexample: Tale.steps(error.counterexample),
        code: code(error.counterexample),
        replay
    })))), Match.orElse((unfinished) => Effect.fail(located(exploration, new Story.StoryFailure({
        title,
        step: 1,
        line: ran,
        problem: String(Arbitrary.formatCheckFailure(unfinished))
    })))));
});
//# sourceMappingURL=Exploration.js.map