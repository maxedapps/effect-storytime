# Explorations

`import { Exploration } from 'effect-storytime/testing'`

An exploration generates tales. It checks many random paths through a Program or a Decider with `effect/Arbitrary`, using every strict rule a story or decision runs ([strict-rules.md](strict-rules.md)). The one rule it skips is command assertions: a path asserts no effects, so it owes none. A failing path shrinks to a short story or decision, its counterexample. Write stories and decisions for the behaviour you mean, and an exploration for the rules that must hold whatever happens: Schemas, purity, JSON copies and invariants.

## Exploring a Program

`Exploration.make(title, program, options)` walks paths that send messages, answer and stream from pending commands, and restart.

<!-- snippet: test/docs/chat.test.ts#explore -->
```ts
const talks = Exploration.make('any conversation keeps the chat valid', chat, {
	given: Arbitrary.map(Arbitrary.schema(Schema.Literals([0, 1, 2])), ready),
	// By default any message the Message Schema allows; this one asks about two turns and stops.
	send: Arbitrary.map(Arbitrary.schema(Schema.Literals(['t1', 't2', 'stop'])), (pick) =>
		pick === 'stop' ? Stopped.make({}) : Asked.make({ turn: pick, text: `question ${pick}` })
	),
	// The messages that complete a pending command; SaveTurn has none, so it stays pending.
	replies: Command.match({
		Ask: ({ turn: asking }) => [
			Answered.make({ turn: asking, left: 1 }),
			Refused.make({ turn: asking, reason: 'Busy' }),
			Refused.make({ turn: asking, reason: 'SignedOut' })
		],
		SaveTurn: () => []
	}),
	// The messages a pending command streams while it stays pending.
	emits: Command.match({
		Ask: ({ turn: asking }) => [Delta.make({ turn: asking, text: 'more' })],
		SaveTurn: () => []
	})
});
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `given` | `Arbitrary<Model>` | required | The models a path starts from. |
| `send` | `Arbitrary<Message>` | `Arbitrary.schema(program.Message)` | The messages a path sends. |
| `replies` | `(command) => ReadonlyArray<Message>` | none | The messages a pending command may complete with. A command with none stays pending. |
| `emits` | `(command) => ReadonlyArray<Message>` | none | The messages a pending command may stream while it stays pending. |
| `restarts` | `boolean` | `true` | Whether paths restart. |
| `runs` | `number` | `100` | How many paths to check. |
| `steps` | `number` | `30` | The most actions a path takes. |
| `seed` | `string \| number` | the title | The seed paths come from, so every run checks the same paths. |

The default `send` is derived when the exploration is made. A Message Schema that `Arbitrary.schema` can't generate from (one with a custom declaration and no arbitrary annotation) throws then, so pass `send` for it. A narrow `send`, such as a few fixed turns, finds more interesting paths than every possible string: messages about the same turn meet each other.

`Arbitrary` has no `oneOf`. To pick between values, generate a literal and map it, as the chat example does with `Schema.Literals`.

## Exploring a Decider

`Exploration.decisions(title, decider, options?)` walks paths of commands decided one after another from a start state. A rejection is a valid outcome.

<!-- snippet: test/docs/membership.test.ts#explore -->
```ts
// The Decider's `initial` and any command the Command Schema allows, by default.
const holds = Exploration.decisions('any commands keep a membership valid', membership);
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `given` | `Arbitrary<State>` | `Arbitrary.Constant(decider.initial)` | The states a path starts from. |
| `when` | `Arbitrary<Command>` | `Arbitrary.schema(decider.Command)` | The commands a path decides. |
| `runs`, `steps`, `seed` | | as above | |

Decider paths never restart.

## Running and failures

`Exploration.check(exploration, options?)` gives `Effect<Exploration.Explored, StoryFailure>`, where `Explored` is `{ runs, cases }`. `Tale.run` and `Vitest.stories` call it for you.

An exploration's single line names its settings: `explore 100 runs of up to 30 steps, seed "any conversation keeps the chat valid", with restarts`. A failure adds the fields below, and its `message` shows them: the counterexample with `>` at the failing step, then the replay token. Its stack starts at the `Exploration.make` or `Exploration.decisions` call.

| Field | Meaning |
| --- | --- |
| `line` | The exploration's line. |
| `counterexample` | The shrunk path as story or decision lines. |
| `step` | The 1-based number of the failing line in `counterexample`. |
| `replay` | A token for `Exploration.check(exploration, { replay })`, which checks just that path again. |

[story-record.md](story-record.md) shows a recorded failure. Replay tokens may change between releases of `effect/Arbitrary`.

To debug a counterexample, copy its lines into a story or decision. That gives you a fixed test for the bug, which stays after the fix.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `make(title, program, options)` | function | Explores a Program. |
| `decisions(title, decider, options?)` | function | Explores a Decider. |
| `check(exploration, { replay }?)` | `Effect<Explored, StoryFailure>` | Checks the paths, or one replayed path. |
| `lines(exploration)` | `ReadonlyArray<string>` | Its one line. |
| `Exploration` | class | An exploration value: `title`, `subject`, `runs`, `steps`, `seed`, `restarts`. |
| `Options<Model, Message, Command>` | interface | `make`'s options. |
| `DecisionOptions<State, Command>` | interface | `decisions`' options. |
| `Explored` | interface | `{ runs, cases }`. |
