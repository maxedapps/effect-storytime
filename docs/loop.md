# Loop

`import { Loop } from 'effect-storytime'`

A Loop runs a Program with Effect. One fiber applies messages in order, the app's handler runs every command, each reply goes back into `update`, and an optional `store` commits the model with the transition's writes. `Loop.run` drives a Program until no command runs; `Loop.make` keeps one running for as long as its scope lives.

## Running a Program to the end

`Loop.run(program, options)` starts a Loop in a scope of its own, dispatches `messages` in order and gives the model once no command runs. The first command that fails fails the run with its typed error: no further message is dispatched, and the commands still running are interrupted. The run is traced as the span `Loop.run`.

<!-- snippet: test/docs/enrolment.test.ts#run -->
```ts
const check = Effect.fn('check')(function* (learner: string) {
	const api = yield* Provider;
	// Starts a Loop in its own scope, dispatches `messages`, runs every command through the
	// handler and feeds its answer back until nothing runs, then gives the model.
	return yield* Loop.run(enrolment, {
		init: { model: idle },
		handler: Command.match({
			FindUser: ({ email }) =>
				Effect.map(api.findUser(email), (id) => Found.make({ id: Option.getOrNull(id) })),
			ReadEnrolment: ({ id }) =>
				Effect.map(api.enrolled(id), (enrolled) => Read.make({ enrolled }))
		}),
		messages: [Check.make({ email: learner })]
	});
});

expect(yield* check('ada@example.com')).toEqual(Decided.make({ step: 'Enrol', id: 7 }));
// A failure the Program doesn't decide on fails the run with its typed error.
expect(yield* Effect.flip(check('bo@example.com'))).toEqual(
	new ProviderFailed({ reason: 'rate limited' })
);
```

The handler is the app's side: it calls the services, and each answer becomes the Program's next message. Map a failure the Program should decide on to a message (`Effect.catchTag('NotFound', () => Effect.succeed(Missing.make(...)))`). Any other failure keeps its type and fails the command, and with it `run`, `settled` and `join`.

## A long-lived Loop

`Loop.make(program, options)` starts a Loop in the current `Scope` and gives `{ dispatch, model, changes, settled, join }`. Write the handler with the Command union's exhaustive `match`, so a new command without a handler doesn't compile.

<!-- snippet: test/docs/loop.test.ts#make -->
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
// Waits until no command runs: Ask, then the SaveTurn its answer led to.
const answered = yield* loop.settled;
```

| Option | Type | Meaning |
| --- | --- | --- |
| `init` | `Program.Next<Model, Command>` | The start when nothing is stored: a model and, optionally, commands to run at once. |
| `handler` | `(command) => Effect<Message \| void, E, R> \| Stream<Message, E, R> \| Loop.Write<E, R>` | Runs a command. An Effect answers with one message or none (`void`), a Stream with every message it emits, and a `Loop.write` runs inside its transition. |
| `store` | `Loop.Store<Model, E, R>`, optional | Where the model lives across restarts, and the transaction each transition commits in. |
| `messages` | `ReadonlyArray<Message>`, `run` only | Dispatched in order once the Loop has started. |

| Member | Type | Meaning |
| --- | --- | --- |
| `dispatch(message)` | `Effect<void, E>` | Applies the message and starts its commands. It completes once the model is updated, before the commands finish, and fails with a failing save or write, which changes nothing. Once the Loop's scope has closed, it is interrupted. |
| `model` | `Effect<Model>` | The current model. |
| `changes` | `Stream<Model>` | The current model, then every model after it. |
| `settled` | `Effect<Model, E>` | Waits until no command runs and gives the model. It fails as soon as a command fails or dies. |
| `join` | `Effect<void, E>` | Waits on the commands. It succeeds once the Loop's scope has closed, and fails as soon as a command fails or dies. |

## How commands run

- A command is identified by its canonical JSON, as in a story. Identical commands in one transition are one: a write runs once and work starts once, where the command first appears. A command fiber is keyed the same way, so a command identical to a running one interrupts and replaces it.
- `cancels` interrupts a running command once the transition's new commands have started, so `settled` sees no idle moment between a reply that cancels its own command and the command it leads to. A message the cancelled command had already sent but the Loop hadn't applied yet is dropped, and so is a message from a replaced command.
- Command fibers only enqueue their messages, and the Loop applies them one at a time in order. A command whose own message cancels it never cuts an `update` short.
- A command that fails or dies ends its own fiber; the Loop keeps applying messages. `settled`, `join` and `run` report it, so await one of them, or race `join` with your app's main fiber.
- Closing the Loop's scope applies the messages already dispatched, then interrupts every command. A `dispatch` after that is interrupted.

## Writes and the store

A transition is the model `init`, `resume` or `update` gives plus its commands. With a `store`, each transition commits in one `store.transaction`: the invariants are checked, `save` stores the model, and every command the handler answers with `Loop.write(effect)` runs, in the order `update` listed it. Only then does the Loop publish the model and start the rest of the commands. A failing save or write rolls the transaction back and changes nothing: `make`, the `dispatch`, or the command whose message it was fails with the error. Use writes for what must commit or roll back with the model: events into a log, an outbox row, an alarm.

On start, `load` runs in the first transaction. When it finds a model, `program.resume(model)` decides what to redo, and `init` is ignored.

<!-- snippet: test/docs/loop.test.ts#store -->
```ts
// The stored model and the transcript, as a database would hold them.
const stored = yield* Ref.make(Option.none<Chat>());
const transcript = yield* Ref.make<ReadonlyArray<string>>([]);
const store: Loop.Store<Chat, never, never> = {
	load: Ref.get(stored),
	save: (model) => Ref.set(stored, Option.some(model)),
	// A database runs the effect in its transaction, `sql.withTransaction`; memory has
	// nothing to roll back.
	transaction: (effect) => effect
};
const handler = (ask: Loop.Work<Message, never, never>) =>
	Command.match({
		Ask: () => ask,
		// A write runs in its transition's transaction, so the turn commits with the model.
		SaveTurn: ({ question, answer }) =>
			Loop.write(Ref.update(transcript, (lines) => [...lines, `${question} ${answer}`]))
	});

// The first process asks, then stops before the answer arrives: closing its scope
// interrupts the running Ask.
yield* Effect.scoped(
	Effect.gen(function* () {
		const first = yield* Loop.make(chat, {
			init: { model: ready(2) },
			handler: handler(Effect.never),
			store
		});
		yield* first.dispatch(Asked.make({ turn: 't1', text: 'Why Effect?' }));
	})
);

// The next one loads the stored Asking model, and `resume` asks again.
const second = yield* Loop.make(chat, {
	init: { model: ready(2) },
	handler: handler(Effect.succeed(Answered.make({ turn: 't1', left: 1 }))),
	store
});
const answered = yield* second.settled;
```

| Member | Type | Meaning |
| --- | --- | --- |
| `load` | `Effect<Option<Model>, E, R>` | The stored model, or `Option.none()`. |
| `save` | `(model) => Effect<void, E, R>` | Stores the model. |
| `transaction` | `(effect) => Effect<A, E \| E2, R \| R2>` | Commits the effect's saves and writes together, or none of them. `Decider.Store`'s shape. |

Encode the model with its Schema for storage (`Schema.encodeEffect(Model)`), so what `load` gives back equals what `save` got, as `Story.restart()` assumes. A Loop loads once, at its start, so run one Loop per stored process at a time: serialise in the app (a Durable Object, a lock, a queue per key).

Writes work without a store too: they then run in order before the model is published, with no transaction around them.

## Invariants

A Loop checks the Program's invariants on every model `init`, `resume` or `update` gives, before it saves that model, runs its writes, publishes it to `model` and `changes`, or starts and cancels its commands, as a story does at the same step. A model that breaks one is a bug in the Program, so the Loop changes nothing and the step dies with the defect `Program.InvariantBroken { invariant, state }`, its message `invariant <name> does not hold for <model>`. An invariant must only read the model: one that changes it dies the same way with `Program.InvariantChanged { invariant, before, after }`, the model's canonical JSON before and after it ran:

- from `Loop.make` or `Loop.run`, when `init` or `resume` gives it,
- from `dispatch`, when the dispatched message's `update` gives it,
- from `settled`, `join` and `run`, when a command's message gives it, since that command's fiber dies.

The Loop keeps running with the model it had. Every other strict rule (Schemas, purity, JSON copies, owed commands) is only checked by the tales ([strict-rules.md](strict-rules.md)). Test the Program with stories and explorations, and keep the handler thin enough that the Program holds every decision.

## Moving a hand-written driver onto a Loop

A driver that runs `update`, calls a service per command, saves the model and feeds answers back by hand becomes three things the app supplies:

- **A handler**: one `Command.match`. Each work case calls the service and maps its answer to a message; each case that must commit with the model returns `Loop.write(effect)`.
- **A store**, when the process outlives a request: `load`, `save` and the database's `transaction`.
- **One call**: `Loop.run(program, { init, handler, store, messages })` for a request that runs to the end, or `Loop.make` for a process that takes messages over time.

It deletes the loop around `update`, the fiber bookkeeping for running and cancelled commands, the model ref, the save-then-run ordering and the wait for the last command.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `run(program, options)` | `Effect<Model, E, R>` | Runs a Program in its own scope until no command runs. |
| `make(program, options)` | `Effect<Loop<Model, Message, E>, E, Scope \| R>` | Starts a Loop in the current scope. |
| `write(effect)` | `Write<E, R>` | Marks a command's effect as part of its transition. |
| `Write<E, R>` | class | What `write` gives: the handler's answer for a command that commits with its transition. |
| `Loop<Model, Message, E>` | interface | `dispatch`, `model`, `changes`, `settled`, `join`. |
| `Options<Model, Message, Command, E, R>` | interface | `init`, `handler`, `store?`. |
| `RunOptions<Model, Message, Command, E, R>` | interface | `Options` and `messages?`. |
| `Handler<Message, Command, E, R>` | type | `(command) => Work<Message, E, R> \| Write<E, R>`. |
| `Work<Message, E, R>` | type | `Effect<Message \| void, E, R> \| Stream<Message, E, R>`. |
| `Store<Model, E, R>` | interface | `load`, `save`, `transaction`. |
