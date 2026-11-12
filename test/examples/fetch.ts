// A fetch that retries itself and ends by cancelling itself, each time starting a second
// command: the replies Chat's stream completion and Conversation's continuations depend on.
import { Schema } from 'effect';
import { Program } from 'effect-storytime';

const Params = Schema.Record(Schema.String, Schema.String);

export const Model = Schema.Struct({ attempts: Schema.Int, fetched: Schema.Boolean });
export type Model = typeof Model.Type;

export const Message = Schema.TaggedUnion({
	Requested: { params: Params },
	Failed: { params: Params },
	Fetched: { params: Params },
	Dropped: { params: Params }
});
export type Message = typeof Message.Type;

export const Command = Schema.TaggedUnion({
	Fetch: { params: Params },
	Note: { text: Schema.String }
});
export type Command = typeof Command.Type;

const { Fetch, Note } = Command.cases;

export const fetch = Program.make({
	Model,
	Message,
	Command,
	update: (model: Model, message: Message) =>
		Message.match(message, {
			Requested: ({ params }) => ({ model, commands: [Fetch.make({ params })] }),
			Failed: ({ params }) => ({
				model: { ...model, attempts: model.attempts + 1 },
				commands: [Fetch.make({ params }), Note.make({ text: 'retrying' })]
			}),
			Fetched: ({ params }) => ({
				model: { ...model, fetched: true },
				cancels: [Fetch.make({ params })],
				commands: [Note.make({ text: 'fetched' })]
			}),
			Dropped: ({ params }) => ({ model, cancels: [Fetch.make({ params })] })
		})
});

export const start: Model = { attempts: 0, fetched: false };
