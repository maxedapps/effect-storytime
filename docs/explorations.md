# Explorations

`import { Exploration } from 'effect-storytime/testing'`

An exploration generates tales. It checks many random paths through a Program or a Decider with `effect/Arbitrary`, using every strict rule a story or decision runs ([strict-rules.md](strict-rules.md)). A path asserts the commands each step produced right after that step, and names each decided command's events or rejection, so a failing path shrinks to a short story or decision, its counterexample, that runs as one. Write stories and decisions for the behaviour you mean, and an exploration for the rules that must hold whatever happens: Schemas, purity, JSON copies, invariants and the exploration's own properties.

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
	}),
	// Named assertions on every update a path runs: a stop cancels the pending ask, and only it.
	properties: {
		stopCancelsTheAsk: ({ before, message, cancels }) =>
			!Message.guards.Stopped(message) || cancels.length === (Chat.guards.Asking(before) ? 1 : 0)
	}
});
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `given` | `Arbitrary<Model>` | required | The models a path starts from. |
| `send` | `Arbitrary<Message>` | `Arbitrary.schema(program.Message)` | The messages a path sends. |
| `replies` | `(command) => ReadonlyArray<Message>` | none | The messages a pending command may complete with. A command with none stays pending. |
| `emits` | `(command) => ReadonlyArray<Message>` | none | The messages a pending command may stream while it stays pending. |
| `restarts` | `boolean` | `true` | Whether paths restart. |
| `properties` | `Exploration.Properties<Exploration.Update<Model, Message, Command>>` | none | Named assertions on every `update` a path runs ([Properties](#properties)). |
| `runs` | `number` | `100` | How many paths to check. |
| `steps` | `number` | `30` | The most actions a path takes. |
| `seed` | `string \| number` | the title | The seed paths come from, so every run checks the same paths unless `STORYTIME_SEED` picks another ([Fresh seeds and more runs](#fresh-seeds-and-more-runs)). |

The default `send` is derived when the exploration is made. A Message Schema that `Arbitrary.schema` can't generate from (one with a custom declaration and no arbitrary annotation) throws then, so pass `send` for it. A narrow `send`, such as a few fixed turns, finds more interesting paths than every possible string: messages about the same turn meet each other.

`Arbitrary` has no `oneOf`. To pick between values, generate a literal and map it, as the chat example does with `Schema.Literals`.

## Exploring a Decider

`Exploration.decisions(title, decider, options?)` walks paths of commands decided one after another from a start state. A rejection is a valid outcome.

<!-- snippet: test/docs/membership.test.ts#explore -->
```ts
// The Decider's `initial` and any command the Command Schema allows, by default.
const holds = Exploration.decisions('any commands keep a membership valid', membership, {
	// Named assertions on every command a path decides: an accepted revoke ends the membership.
	properties: {
		revokeEnds: ({ command, decided, after }) =>
			!Command.guards.Revoke(command) || Result.isFailure(decided) || !after.active
	}
});
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `given` | `Arbitrary<State>` | `Arbitrary.Constant(decider.initial)` | The states a path starts from. |
| `when` | `Arbitrary<Command>` | `Arbitrary.schema(decider.Command)` | The commands a path decides. |
| `properties` | `Exploration.Properties<Exploration.Ruling<State, Command, Event, Rejection>>` | none | Named assertions on every command a path decides ([Properties](#properties)). |
| `runs`, `steps`, `seed` | | as above | |

Decider paths never restart.

## Properties

An invariant judges one model or state. A property judges a whole step: what held before, what ran and what it gave. `properties` names predicates that must return `true` for every step of every path, checked after that step's strict rules. A failing or throwing property fails the step like any rule, so its path shrinks and gets a replay token. The problem is `property <name> does not hold`, with the step as canonical JSON in `actual`, or `property <name> threw: …`.

| Subject | A property takes | Fields |
| --- | --- | --- |
| Program | `Exploration.Update<Model, Message, Command>` | `before` (the model `update` got), `message`, `after` (the model it gave), `commands`, `cancels` |
| Decider | `Exploration.Ruling<State, Command, Event, Rejection>` | `before` (the state decided on), `command`, `decided` (`Result` of the events or the rejection), `after` (the state the events reached, or `before` on a rejection) |

A Program's properties see every `update`: sent messages, replies and stream messages. A restart's `resume` gives no `Update`, since no message ran. Properties are pure predicates, like invariants.

The chat's exploration above checks that a stop cancels the pending ask and nothing else, and the membership's checks that an accepted revoke ends the membership.

Stories have no properties: a story asserts each step it means with `model`, `satisfies` and `commands`.

## Running and failures

`Exploration.check(exploration, options?)` gives `Effect<Exploration.Explored, StoryFailure>`, where `Explored` is `{ runs, cases }`. `Tale.run` and `Vitest.stories` call it for you.

An exploration's single line names its settings: `explore 100 runs of up to 30 steps, seed "any conversation keeps the chat valid", with restarts`. A failure adds the fields below, and its `message` shows them: the line that ran, the counterexample's lines with `>` at the failing step, the replay token, then the counterexample as code. Its stack starts at the `Exploration.make` or `Exploration.decisions` call.

| Field | Meaning |
| --- | --- |
| `line` | The exploration's line as it ran, with the seed and runs it used, or `replay <token>` for a replay. |
| `counterexample` | The shrunk path as steps ([story-record.md](story-record.md#steps-and-values)); `StoryRecord.line` shows each as its line. |
| `step` | The 1-based number of the failing step in `counterexample`. |
| `replay` | A token for `Exploration.check(exploration, { replay })`, which checks just that path again. |
| `code` | The counterexample as a `Story.make(...)` or `Decision.make(...)` call to paste into a test. |

[story-record.md](story-record.md) shows a recorded failure. Replay tokens may change between releases of `effect/Arbitrary`.

To debug a counterexample, paste its `code` into a test. It names the subject `program` or `decider` and the step builders `story` or `decision` (`Story.of(program)`, `Decision.of(decider)`), and first declares a decoder for each Schema its values use, such as `const model = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Model)))`. Each value is its canonical JSON as its line shows it, decoded back into the value the path had: branded, a class instance, a `Date` or an `Option`. The pasted tale fails at the same step, and it stays as a test for the bug after the fix.

A property is the exploration's own, and tales have none, so a pasted property failure runs to the end: a decision passes, with the failing command's events or rejection named, and a story ends at the failing step, asking for any commands it produced. Assert there what the property checks, with `model`, `state` or `satisfies`.

## Fresh seeds and more runs

An exploration checks the same paths on every run, so CI stays deterministic but never looks further. Two environment variables, read through Effect's `Config` when the exploration is checked, look further on demand:

| Variable | Value | Effect |
| --- | --- | --- |
| `STORYTIME_SEED` | `random` | Every exploration draws a fresh integer seed. |
| `STORYTIME_SEED` | an integer | Every exploration uses that seed. |
| `STORYTIME_RUNS` | a positive integer | Every exploration checks that many paths. |

They win over the exploration's own `seed` and `runs`, and apply wherever an exploration is checked, `covers` included. Any other value fails the check as a defect. Run them locally or in a scheduled CI job, such as `STORYTIME_SEED=random STORYTIME_RUNS=1000 pnpm vitest run`.

A failure's message shows the line that ran, so it names the seed it used: `explore 1000 runs of up to 30 steps, seed 1834212977, with restarts`. Run that again with `STORYTIME_SEED=1834212977 STORYTIME_RUNS=1000` to get the same failure, or use its replay token. The exploration's `lines` and its step in the story record keep the settings as written, so the record stays the same whatever the environment; only a failure's `line` shows the overrides. A replay ignores them: it checks the token's one path, and its failure's `line` is `replay <token>`.

To set them from code, as in a test of your own, provide a `ConfigProvider` such as `ConfigProvider.fromEnv({ env: { STORYTIME_SEED: 'random' } })` to the Effect that checks the exploration.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `make(title, program, options)` | function | Explores a Program. |
| `decisions(title, decider, options?)` | function | Explores a Decider. |
| `check(exploration, { replay }?)` | `Effect<Explored, StoryFailure>` | Checks the paths, or one replayed path, with the `STORYTIME_SEED` and `STORYTIME_RUNS` overrides. |
| `lines(exploration)` | `ReadonlyArray<string>` | Its one line. |
| `Exploration` | class | An exploration value: `title`, `subject`, `runs`, `steps`, `seed`, `restarts`. |
| `Options<Model, Message, Command>` | interface | `make`'s options. |
| `DecisionOptions<State, Command>` | interface | `decisions`' options. |
| `Explored` | interface | `{ runs, cases }`. |
