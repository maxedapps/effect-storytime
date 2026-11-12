// A chat shaped like infinite's chat.svelte.ts: one question at a time, a streamed answer, a
// daily limit and refusals.
import { Schema } from 'effect';
import { Program } from 'effect-storytime';

// #region schemas
const Turn = Schema.Struct({ id: Schema.String, question: Schema.String, answer: Schema.String });

export const Chat = Schema.TaggedUnion({
	Ready: { turns: Schema.Array(Turn), left: Schema.Int },
	Asking: {
		turns: Schema.Array(Turn),
		left: Schema.Int,
		turn: Schema.String,
		question: Schema.String,
		answer: Schema.String
	},
	Limited: { turns: Schema.Array(Turn) },
	SignedOut: {}
});
export type Chat = typeof Chat.Type;

export const Message = Schema.TaggedUnion({
	Asked: { turn: Schema.String, text: Schema.String },
	Delta: { turn: Schema.String, text: Schema.String },
	Answered: { turn: Schema.String, left: Schema.Int },
	Refused: { turn: Schema.String, reason: Schema.Literals(['Busy', 'LimitReached', 'SignedOut']) },
	Stopped: {}
});
export type Message = typeof Message.Type;

export const Command = Schema.TaggedUnion({
	Ask: { turn: Schema.String, text: Schema.String },
	SaveTurn: { id: Schema.String, question: Schema.String, answer: Schema.String }
});
export type Command = typeof Command.Type;

const { Ready, Asking, Limited, SignedOut } = Chat.cases;
const { Ask, SaveTurn } = Command.cases;
// #endregion schemas

// #region update
const ask = (chat: Chat, asked: typeof Message.cases.Asked.Type) =>
	Chat.match(chat, {
		Ready: (ready) =>
			ready.left === 0
				? { model: Limited.make({ turns: ready.turns }) }
				: {
						model: Asking.make({
							turns: ready.turns,
							left: ready.left,
							turn: asked.turn,
							question: asked.text,
							answer: ''
						}),
						commands: [Ask.make({ turn: asked.turn, text: asked.text })]
					},
		Asking: () => ({ model: chat }),
		Limited: () => ({ model: chat }),
		SignedOut: () => ({ model: chat })
	});

const whileAsking = (
	chat: Chat,
	turn: string,
	next: (asking: typeof Asking.Type) => Program.Next<Chat, Command>
): Program.Next<Chat, Command> =>
	Chat.guards.Asking(chat) && chat.turn === turn ? next(chat) : { model: chat };

const refuse = (asking: typeof Asking.Type, reason: typeof Message.cases.Refused.Type.reason) => {
	const model = {
		Busy: Ready.make({ turns: asking.turns, left: asking.left }),
		LimitReached: Limited.make({ turns: asking.turns }),
		SignedOut: SignedOut.make({})
	}[reason];
	return { model };
};

export const update = (chat: Chat, message: Message): Program.Next<Chat, Command> =>
	Message.match(message, {
		Asked: (asked) => ask(chat, asked),
		Delta: ({ turn, text }) =>
			whileAsking(chat, turn, (asking) => ({
				model: Asking.make({ ...asking, answer: asking.answer + text })
			})),
		Answered: ({ turn, left }) =>
			whileAsking(chat, turn, (asking) => {
				const done = { id: asking.turn, question: asking.question, answer: asking.answer };
				return {
					model: Ready.make({ turns: [...asking.turns, done], left }),
					commands: [SaveTurn.make(done)]
				};
			}),
		Refused: ({ turn, reason }) => whileAsking(chat, turn, (asking) => refuse(asking, reason)),
		Stopped: () =>
			Chat.guards.Asking(chat)
				? {
						model: Ready.make({ turns: chat.turns, left: chat.left }),
						cancels: [Ask.make({ turn: chat.turn, text: chat.question })]
					}
				: { model: chat }
	});
// #endregion update

// #region program
export const chat = Program.make({
	Model: Chat,
	Message,
	Command,
	update,
	// The answer streams again from the start, so the partial one is dropped.
	resume: (model) =>
		Chat.guards.Asking(model)
			? {
					model: Asking.make({ ...model, answer: '' }),
					commands: [Ask.make({ turn: model.turn, text: model.question })]
				}
			: { model },
	invariants: {
		leftIsNeverNegative: (model) => !('left' in model) || model.left >= 0
	}
});
// #endregion program

export const ready = (left: number) => Ready.make({ turns: [], left });
