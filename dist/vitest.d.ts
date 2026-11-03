import { Effect } from 'effect';
import type { TestContext } from 'vitest';
import type { Exploration } from './Exploration.ts';
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
/**
 * Runs a tale, or `run` when it needs services (such as `Decision.against` inside `layer(...)`),
 * and records it in the test's meta. A failure fails the test.
 */
export declare const tell: <E = never, R = never>(ctx: TestContext, tale: Tale.Tale, run?: Effect.Effect<Tale.Reached, Story.StoryFailure | E, R>) => Effect.Effect<Tale.Reached, Story.StoryFailure | E, R>;
/** Registers one test per tale, named by its title. */
export declare const stories: (...tales: ReadonlyArray<Tale.Tale>) => void;
/** Registers one test requiring a Program's tales to touch every one of its cases. */
export declare const covers: <Model, Message extends Tagged, Command extends Tagged>(program: Program<Model, Message, Command>, tales: ReadonlyArray<Story.Story<Model, Message, Command> | Exploration<Model, Message, Command>>) => void;
