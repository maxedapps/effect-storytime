# Loop

`import { Loop } from 'effect-storytime'`

A Loop runs a Program with Effect. One fiber applies messages in order, every command runs as its own fiber, and an optional `persist` keeps the model across restarts.

## Running a Program

`Loop.make(program, options)` starts a Loop in the current `Scope` and gives `{ dispatch, model, changes, join }`. The handler runs each command. Write it with the Command union's exhaustive `match`, so a new command without a handler doesn't compile.

<!-- snippet: test/docs/loop.test.ts#run -->
```ts
const loop = yield* Loop.make(chat, {
	init: { model: ready(2) },
	// The Command union's exhaustive match: a new command without a handler does not compile.
	handler: Command.match({
		// A Stream handler answers with every message it emits.
		Ask: ({ turn }) =>
			Stream.make(
				Delta.make({ turn, text: 'Typed errors.' }),
				Answered.make({ turn, left: 1 })
			),
		// An Effect handler answers with one message, or none.
		SaveTurn: () => Effect.void
	})
});
// Returns once `update` ran and the commands started, not when they finish.
yield* loop.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
const answered = yield* loop.changes.pipe(Stream.filter(Chat.guards.Ready), Stream.runHead);
```

| Option | Type | Meaning |
| --- | --- | --- |
| `init` | `Program.Next<Model, Command>` | The start when nothing is stored: a model and, optionally, commands to run at once. |
| `handler` | `(command) => Effect<Message \| void, never, R> \| Stream<Message, never, R>` | Runs a command. An Effect answers with one message or none (`void`), and a Stream answers with every message it emits. |
| `persist` | `{ load, save }`, optional | Where the model lives across restarts. |

| Member | Type | Meaning |
| --- | --- | --- |
| `dispatch(message)` | `Effect<void>` | Applies the message and starts its commands. It completes once the model is updated, before the commands finish. Once the Loop's scope has closed, it is interrupted. |
| `model` | `Effect<Model>` | The current model. |
| `changes` | `Stream<Model>` | The current model, then every model after it. |
| `join` | `Effect<void>` | Waits on the command fibers. It succeeds once the Loop's scope has closed, and dies as soon as a command dies. |

## How commands run

- A command fiber is keyed by the command's canonical JSON. A command identical to a running one interrupts and replaces it.
- `cancels` interrupts a running command. A message it had already sent but the Loop hadn't applied yet is dropped, and so is a message from a replaced command.
- Command fibers only enqueue their messages, and the Loop applies them one at a time in order. A command whose own message cancels it never cuts an `update` short.
- Closing the Loop's scope applies the messages already dispatched, then interrupts every command. A `dispatch` after that is interrupted.

The handler's error channel is `never`: a failure must become a message (`Effect.catchTag(..., () => Effect.succeed(Failed.make(...)))`), so the Program decides what it means. A defect still ends its command fiber, and the Loop keeps running. Fork `loop.join` beside the Loop, or race it with your app's main fiber, to see that defect and stop.

## Persisting the model

With `persist`, a Loop saves each model before it starts that model's commands. On start it loads the stored model. When there is one, `program.resume(model)` decides what to redo, and `init` is ignored.

<!-- snippet: test/docs/loop.test.ts#persist -->
```ts
const stored = yield* Ref.make(Option.none<Chat>());
const persist = {
	load: Ref.get(stored),
	save: (model: Chat) => Ref.set(stored, Option.some(model))
};

// The first process asks, then stops before the answer arrives: closing its scope
// interrupts the running Ask.
yield* Effect.scoped(
	Effect.gen(function* () {
		const first = yield* Loop.make(chat, {
			init: { model: ready(2) },
			handler: Command.match({ Ask: () => Effect.never, SaveTurn: () => Effect.void }),
			persist
		});
		yield* first.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
	})
);

// The next one loads the stored Asking model, and `resume` asks again.
const second = yield* Loop.make(chat, {
	init: { model: ready(2) },
	handler: Command.match({
		Ask: ({ turn }) => Effect.succeed(Answered.make({ turn, left: 1 })),
		SaveTurn: () => Effect.void
	}),
	persist
});
const answered = yield* second.changes.pipe(Stream.filter(Chat.guards.Ready), Stream.runHead);
```

| Member | Type | Meaning |
| --- | --- | --- |
| `load` | `Effect<Option<Model>, never, R>` | The stored model, or `Option.none()`. |
| `save` | `(model) => Effect<void, never, R>` | Stores the model. |

Both have the error type `never`: by the time a Loop runs, an infrastructure failure here is a defect. Map a database error to a defect with `Effect.orDie` when you implement them. Encode the model with its Schema for storage (`Schema.encodeEffect(Model)`), so what `load` gives back equals what `save` got, as `Story.restart()` assumes.

## Invariants

A Loop checks the Program's invariants on every model `init`, `resume` or `update` gives, before it saves that model, publishes it to `model` and `changes`, or starts and cancels its commands, as a story does at the same step. A model that breaks one is a bug in the Program, so the Loop changes nothing and the step dies with the defect `Program.InvariantBroken { invariant, state }`, its message `invariant <name> does not hold for <model>`:

- from `Loop.make`, when `init` or `resume` gives it,
- from `dispatch`, when the dispatched message's `update` gives it,
- from `join`, when a command's message gives it, since that command's fiber dies.

The Loop keeps running with the model it had. Every other strict rule (Schemas, purity, JSON copies, owed commands) is only checked by the tales ([strict-rules.md](strict-rules.md)). Test the Program with stories and explorations, and keep the handler thin enough that the Program holds every decision.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `make(program, options)` | `Effect<Loop<Model, Message>, never, Scope \| R>` | Starts a Loop in the current scope. |
| `Loop<Model, Message>` | interface | `dispatch`, `model`, `changes`, `join`. |
| `Options<Model, Message, Command, R>` | interface | `init`, `handler`, `persist?`. |
| `Handler<Message, Command, R>` | type | `(command) => Effect<Message \| void, never, R> \| Stream<Message, never, R>`. |
| `Persist<Model, R>` | interface | `load`, `save`. |
