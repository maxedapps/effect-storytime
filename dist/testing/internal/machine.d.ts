/**
 * A Program's steps with every strict rule, shared by authored stories and explored paths. Each
 * step takes the state so far and gives the next, or fails with a Problem.
 */
import { Effect, Option } from 'effect';
import type { Program, Tagged } from '../../Program.ts';
import { Problem } from './check.ts';
interface Pending<Command> {
    readonly key: string;
    readonly command: Command;
    /** Produced and not yet named by a step. */
    readonly owed: boolean;
}
export interface State<Model, Command> {
    readonly model: Model;
    readonly pending: ReadonlyArray<Pending<Command>>;
    /** Keys cancelled since the enclosing `anyOrder` began, whose replies it skips; none outside one. */
    readonly cancelled: Option.Option<ReadonlyArray<string>>;
    readonly cases: ReadonlyArray<string>;
}
/**
 * The steps of `program`. With `owing`, every produced command is owed an assertion; explored
 * paths assert no effects, so they owe none.
 */
export declare const machine: <Model, Message extends Tagged, Command extends Tagged>(program: Program<Model, Message, Command>, owing: boolean) => {
    pendingLines: (pending: ReadonlyArray<Pending<Command>>) => string;
    /**
     * The state a story starts from, once the model passes every check. It holds the model's
     * decoded copy, so a callback that mutates it never changes the story's own.
     */
    start: (model: Model) => Effect.Effect<State<Model, Command>, Problem, never>;
    send: (state: State<Model, Command>, message: Message) => Effect.Effect<{
        model: Model;
        pending: readonly Pending<Command>[];
        cancelled: Option.Option<readonly string[]>;
        cases: string[];
    }, Problem, never>;
    model: (state: State<Model, Command>, expected: Model) => Effect.Effect<State<Model, Command>, Problem, never>;
    satisfies: (state: State<Model, Command>, label: string, check: (model: Model) => boolean) => Effect.Effect<State<Model, Command>, Problem, never>;
    commands: (state: State<Model, Command>, expected: ReadonlyArray<Command>) => Effect.Effect<{
        model: Model;
        cancelled: Option.Option<ReadonlyArray<string>>;
        cases: ReadonlyArray<string>;
        pending: {
            key: string;
            command: Command;
            owed: boolean;
        }[];
    }, Problem, never>;
    /** Completes a pending command and feeds its reply, if any. */
    resolve: (state: State<Model, Command>, command: Command, reply: Option.Option<Message>) => Effect.Effect<State<Model, Command>, Problem, never>;
    /** Feeds a message from a pending streaming command, which stays pending. */
    emit: (state: State<Model, Command>, command: Command, message: Message) => Effect.Effect<State<Model, Command>, Problem, never>;
    /** Round-trips the model through JSON, drops every pending command and applies `resume`. */
    restart: (state: State<Model, Command>) => Effect.Effect<{
        model: Model;
        pending: readonly Pending<Command>[];
        cancelled: Option.Option<readonly string[]>;
        cases: string[];
    }, Problem, never>;
};
export {};
//# sourceMappingURL=machine.d.ts.map