// A conversation shaped like infinite's Conversation Durable Object: a turn runs in steps, a
// restart redoes the running step, and a recall cancels it.
import { Schema } from 'effect';
import { Program } from '../../src/index.ts';

export const Phase = Schema.TaggedUnion({
	Idle: {},
	Working: { turn: Schema.String, step: Schema.Int, output: Schema.String },
	Done: { turn: Schema.String, output: Schema.String },
	Recalled: { turn: Schema.String }
});
export type Phase = typeof Phase.Type;

export const Message = Schema.TaggedUnion({
	Started: { turn: Schema.String },
	StepDone: { turn: Schema.String, step: Schema.Int, output: Schema.String, last: Schema.Boolean },
	Recall: { turn: Schema.String }
});
export type Message = typeof Message.Type;

export const Command = Schema.TaggedUnion({
	RunStep: { turn: Schema.String, step: Schema.Int }
});
export type Command = typeof Command.Type;

const { Idle, Working, Done, Recalled } = Phase.cases;
const { RunStep } = Command.cases;

const working = (phase: Phase, turn: string) =>
	Phase.guards.Working(phase) && phase.turn === turn ? [phase] : [];

export const conversation = Program.make({
	Model: Phase,
	Message,
	Command,
	update: (phase: Phase, message: Message): Program.Next<Phase, Command> =>
		Message.match(message, {
			Started: ({ turn }) =>
				Phase.guards.Working(phase)
					? { model: phase }
					: {
							model: Working.make({ turn, step: 0, output: '' }),
							commands: [RunStep.make({ turn, step: 0 })]
						},
			StepDone: ({ turn, step, output, last }) => {
				const [running] = working(phase, turn);
				if (running?.step !== step) return { model: phase };
				const so = running.output + output;
				return last
					? { model: Done.make({ turn, output: so }) }
					: {
							model: Working.make({ turn, step: step + 1, output: so }),
							commands: [RunStep.make({ turn, step: step + 1 })]
						};
			},
			Recall: ({ turn }) => {
				const [running] = working(phase, turn);
				return {
					model: Recalled.make({ turn }),
					cancels: running ? [RunStep.make({ turn, step: running.step })] : []
				};
			}
		}),
	resume: (phase) =>
		Phase.guards.Working(phase)
			? { model: phase, commands: [RunStep.make({ turn: phase.turn, step: phase.step })] }
			: { model: phase }
});

export const idle = Idle.make({});
