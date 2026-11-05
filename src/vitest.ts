/**
 * Tells tales as Vitest tests through `@effect/vitest`. Each told tale leaves its record in the
 * test's meta, where the story reporter collects it.
 */
import { it } from '@effect/vitest';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import type { TestContext } from 'vitest';
import type { Decider } from './Decider.ts';
import type { Program, Tagged } from './Program.ts';
import * as Story from './Story.ts';
import type { StoryRecord } from './StoryRecord.ts';
import * as Tale from './Tale.ts';

/** A tale's record before the reporter adds the file and test that told it. */
export type Told = Omit<StoryRecord, 'file' | 'test'>;

declare module 'vitest' {
	interface TaskMeta {
		storytime?: ReadonlyArray<Told>;
	}
}

const isStoryFailure = Schema.is(Story.StoryFailure);

const told = (tale: Tale.Tale, exit: Exit.Exit<Tale.Reached, unknown>): Told => ({
	kind: tale._tag,
	title: tale.title,
	lines: Tale.lines(tale),
	...Exit.match(exit, {
		onSuccess: ({ final, cases }): Pick<Told, 'status' | 'final' | 'cases'> => ({
			status: 'passed',
			final,
			cases
		}),
		onFailure: (cause): Pick<Told, 'status' | 'failure'> => ({
			status: 'failed',
			failure: Option.getOrUndefined(
				Option.map(
					Option.filter(Cause.findErrorOption(cause), isStoryFailure),
					({ step, line, message, expected, actual, counterexample, replay }) => ({
						step,
						line,
						message,
						expected,
						actual,
						counterexample,
						replay
					})
				)
			)
		})
	})
});

/**
 * Runs a tale, or `run` when it needs services (such as `Decision.against` inside `layer(...)`),
 * and records it in the test's meta. A failure fails the test.
 */
export const tell = <E = never, R = never>(
	ctx: TestContext,
	tale: Tale.Tale,
	run?: Effect.Effect<Tale.Reached, Story.StoryFailure | E, R>
): Effect.Effect<Tale.Reached, Story.StoryFailure | E, R> =>
	Effect.onExit(run ?? Tale.run(tale), (exit) =>
		Effect.sync(() => {
			ctx.task.meta.storytime = [...(ctx.task.meta.storytime ?? []), told(tale, exit)];
		})
	);

/** Registers one test per tale, named by its title. */
export const stories = (...tales: ReadonlyArray<Tale.Tale>): void => {
	for (const tale of tales) it.effect(tale.title, (ctx) => tell(ctx, tale));
};

/** Registers one test requiring a Program's or a Decider's tales to touch every one of its cases. */
export const covers = <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	State,
	Input,
	Event,
	Rejection
>(
	subject: Program<Model, Message, Command> | Decider<State, Input, Event, Rejection>,
	tales: ReadonlyArray<Tale.Tale>
): void => {
	it.effect('its tales touch every case', () => Tale.covers(subject, tales));
};
