/**
 * Tells tales as Vitest tests through `@effect/vitest`. Each told tale leaves its record in the
 * test's meta, where the story reporter collects it.
 */
import { it } from '@effect/vitest';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import * as Story from './Story.js';
import * as Tale from './Tale.js';
const isStoryFailure = Schema.is(Story.StoryFailure);
const told = (tale, exit) => ({
    kind: tale._tag,
    title: tale.title,
    lines: Tale.lines(tale),
    ...Exit.match(exit, {
        onSuccess: ({ final, cases }) => ({
            status: 'passed',
            final,
            cases
        }),
        onFailure: (cause) => ({
            status: 'failed',
            failure: Option.getOrUndefined(Option.map(Option.filter(Cause.findErrorOption(cause), isStoryFailure), ({ step, line, message, expected, actual, counterexample, replay }) => ({
                step,
                line,
                message,
                expected,
                actual,
                counterexample,
                replay
            })))
        })
    })
});
/**
 * Runs a tale, or `run` when it needs services (such as `Decision.against` inside `layer(...)`),
 * and records it in the test's meta. A failure fails the test.
 */
export const tell = (ctx, tale, run) => Effect.onExit(run ?? Tale.run(tale), (exit) => Effect.sync(() => {
    ctx.task.meta.storytime = [...(ctx.task.meta.storytime ?? []), told(tale, exit)];
}));
/** Registers one test per tale, named by its title. */
export const stories = (...tales) => {
    for (const tale of tales)
        it.effect(tale.title, (ctx) => tell(ctx, tale));
};
/** Registers one test requiring a Program's or a Decider's tales to touch every one of its cases. */
export const covers = (subject, tales) => {
    it.effect('its tales touch every case', () => Tale.covers(subject, tales));
};
//# sourceMappingURL=vitest.js.map