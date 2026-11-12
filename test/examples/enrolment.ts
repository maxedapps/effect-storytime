// An enrolment check shaped like infinite's Teachable mirroring: find the learner's account at a
// course provider, read its enrolment, then decide what to change. `Loop.run` drives it to the end.
import { Context, Effect, Option, Schema } from 'effect';
import { Program } from 'effect-storytime';

export const Step = Schema.Literals(['Create', 'Enrol', 'Keep']);

export const Enrolment = Schema.TaggedUnion({
	Idle: {},
	Finding: { email: Schema.String },
	Reading: { id: Schema.Int },
	Decided: { step: Step, id: Schema.NullOr(Schema.Int) }
});
export type Enrolment = typeof Enrolment.Type;

export const Message = Schema.TaggedUnion({
	Check: { email: Schema.String },
	Found: { id: Schema.NullOr(Schema.Int) },
	Read: { enrolled: Schema.Boolean }
});
export type Message = typeof Message.Type;

export const Command = Schema.TaggedUnion({
	FindUser: { email: Schema.String },
	ReadEnrolment: { id: Schema.Int }
});
export type Command = typeof Command.Type;

const { Idle, Finding, Reading, Decided } = Enrolment.cases;
const { FindUser, ReadEnrolment } = Command.cases;

export const idle = Idle.make({});

export const enrolment = Program.make({
	Model: Enrolment,
	Message,
	Command,
	update: (model: Enrolment, message: Message): Program.Next<Enrolment, Command> =>
		Message.match(message, {
			Check: ({ email }) =>
				Enrolment.guards.Idle(model)
					? { model: Finding.make({ email }), commands: [FindUser.make({ email })] }
					: { model },
			Found: ({ id }) => {
				if (!Enrolment.guards.Finding(model)) return { model };
				if (id === null) return { model: Decided.make({ step: 'Create', id }) };
				return { model: Reading.make({ id }), commands: [ReadEnrolment.make({ id })] };
			},
			Read: ({ enrolled }) =>
				Enrolment.guards.Reading(model)
					? { model: Decided.make({ step: enrolled ? 'Keep' : 'Enrol', id: model.id }) }
					: { model }
		}),
	// A restart asks again for whatever was pending.
	resume: (model: Enrolment): Program.Next<Enrolment, Command> =>
		Enrolment.match(model, {
			Idle: () => ({ model }),
			Finding: ({ email }) => ({ model, commands: [FindUser.make({ email })] }),
			Reading: ({ id }) => ({ model, commands: [ReadEnrolment.make({ id })] }),
			Decided: () => ({ model })
		}),
	invariants: {
		'only a learner without an account gets one': (model) =>
			!Enrolment.guards.Decided(model) || (model.step === 'Create') === (model.id === null)
	}
});

export class ProviderFailed extends Schema.TaggedError<ProviderFailed>()('ProviderFailed', {
	reason: Schema.String
}) {}

/** The course provider's API, as the app's service. */
export class Provider extends Context.Service<
	Provider,
	{
		readonly findUser: (email: string) => Effect.Effect<Option.Option<number>, ProviderFailed>;
		readonly enrolled: (id: number) => Effect.Effect<boolean, ProviderFailed>;
	}
>()('Provider') {}
