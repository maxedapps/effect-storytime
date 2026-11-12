# Program

`import { Program } from 'effect-storytime'`

A Program is a pure state machine for a process or a screen. `update(model, message)` returns the next model, the commands to start and the commands to cancel. Commands are Schema data: a Loop runs them ([loop.md](loop.md)), and a story asserts them ([stories.md](stories.md)).

## Defining a Program

The chat example asks one question at a time, streams the answer and has a daily limit. Its Schemas:

<!-- snippet: test/examples/chat.ts#schemas -->
```ts
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
```

`update` matches the message, and often the model, exhaustively. Every branch returns a `Program.Next`:

<!-- snippet: test/examples/chat.ts#update -->
```ts
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
```

Then `Program.make` ties it together. `resume` says what to redo after a restart, and invariants name what every model must satisfy:

<!-- snippet: test/examples/chat.ts#program -->
```ts
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
```

`Program.make(definition)` takes:

| Field | Type | Meaning |
| --- | --- | --- |
| `Model` | `Schema.Codec<Model, unknown>` | Any Schema. A tagged union adds its cases to coverage. |
| `Message` | `Program.Cases<Message>` | A Schema that lists its `cases`, such as `Schema.TaggedUnion`. |
| `Command` | `Program.Cases<Command>` | The same, for commands. |
| `update` | `(model, message) => Next<Model, Command>` | Pure. |
| `resume` | `(model) => Next<Model, Command>`, optional | What to redo after a restart, from the stored model alone. Keeps the model and starts nothing by default. |
| `invariants` | `Record<string, (model) => boolean>`, optional | Named predicates every model must satisfy. `{}` by default. |

## Next

`update` and `resume` return a `Program.Next<Model, Command>`:

| Field | Meaning |
| --- | --- |
| `model` | The next model. |
| `commands?` | Commands to start. A command identical (by canonical JSON) to a running one replaces it. |
| `cancels?` | Commands to stop. A Loop interrupts them and drops any message they still send. |

Name a cancelled command by its full value, the same one that started it, since its identity is its canonical JSON. The chat's `Stopped` cancels `Ask.make({ turn: chat.turn, text: chat.question })`, which equals the `Ask` it started.

## Restarts and resume

A restart (a new process, a deploy, a crash) loads the stored model and calls `resume(model)`. No pending command survives a restart, so `resume` must start again whatever the model says is under way. The chat's `resume` asks again from the start and clears the partial answer, because the stream restarts too.

The model is the only memory: whatever `resume` needs must be in the model. A story checks this with a `restart()` step ([stories.md](stories.md)), and an exploration restarts its paths at random ([explorations.md](explorations.md)).

## Invariants

A Program's invariants are checked on the starting model and on every model `update` or `resume` gives: after each step of every story and explored path, and in a Loop before it saves, publishes or starts anything for that model ([loop.md](loop.md#invariants)). A model that breaks one is a bug in the Program: a tale fails with `invariant <name> does not hold`, and a Loop dies with the defect `Program.InvariantBroken`. An invariant only reads the model: one that changes it fails a tale with `invariant <name> changed its input`, and a Loop dies with `Program.InvariantChanged`.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `make(definition)` | function | Builds a `Program`, defaulting `resume` and `invariants`. |
| `Program<Model, Message, Command>` | interface | What `make` returns. |
| `Definition<Model, Message, Command>` | interface | What `make` takes. |
| `Next<Model, Command>` | interface | `{ model, commands?, cancels? }`. |
| `Cases<A>` | interface | A Schema of tagged values with a `cases` record, such as `Schema.TaggedUnion`. |
| `Tagged` | interface | `{ readonly _tag: string }`. |
| `Invariants<Model>` | type | `Readonly<Record<string, (model: Model) => boolean>>`, shared with Deciders. |
| `InvariantBroken` | `Schema.TaggedError` | The defect a Loop or `Decider.handle` dies with: `{ invariant, state }`, message `invariant <name> does not hold for <state>`. |
| `InvariantChanged` | `Schema.TaggedError` | The defect a Loop or `Decider.handle` dies with when an invariant changes the model or state: `{ invariant, before, after }` in canonical JSON, message `invariant <name> changed <before> to <after>`. |
