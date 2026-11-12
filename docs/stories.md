# Stories

`import { Story } from 'effect-storytime/testing'`

A story tells how a Program behaves as steps. It starts from a model, sends messages, and names every command the Program asks for along with how each one ends. A story is a value: a title, its Program and its steps. `Story.run` checks every step and the strict rules in between ([strict-rules.md](strict-rules.md)).

## Writing a story

`Story.of(program)` gives the step builders, typed by the Program, so steps need no type arguments. `Story.make(title, program, ...steps)` builds the story. The examples use the chat Program from [program.md](program.md).

<!-- snippet: test/docs/chat.test.ts#answers -->
```ts
// The step builders, typed by the Program.
const story = Story.of(chat);

const ask = Ask.make({ turn: 't1', text: 'Why Effect?' });
const turn = { id: 't1', question: 'Why Effect?', answer: 'Typed errors.' };

const answers = Story.make(
	'a question is answered while it streams',
	chat,
	story.given(ready(2)),
	story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	story.commands(ask),
	story.emit(ask, Delta.make({ turn: 't1', text: 'Typed errors.' })),
	story.resolve(ask, Answered.make({ turn: 't1', left: 1 })),
	story.commands(SaveTurn.make(turn)),
	// A command that answers with no message resolves without a reply.
	story.resolve(SaveTurn.make(turn)),
	story.model(Ready.make({ turns: [turn], left: 1 }))
);
```

| Step | Meaning |
| --- | --- |
| `given(model)` | Starts the story from a model. It comes first and only once. |
| `send(message)` | Runs `update` with the message. |
| `model(expected)` | Requires the model to equal `expected` by canonical JSON. |
| `satisfies(label, check)` | Requires the model to pass `check`. Lines show the label. |
| `commands(...commands)` | Requires exactly these commands to be pending, in any order. `commands()` means none. |
| `resolve(command, reply?)` | Completes a pending command and runs `update` with its reply, if it has one. |
| `emit(command, message)` | Runs `update` with one message from a pending streaming command, which stays pending. |
| `restart()` | Restarts as after a crash: the model goes through JSON, every pending command is dropped and `resume` decides what to redo. |
| `anyOrder(...steps)` | Runs the rest of the story once for every order of these 2 to 5 steps. |
| `steps(...steps)` | Groups steps, so several stories can share a part. |

Every command `update` or `resume` produces is owed an assertion: a `commands`, `resolve` or `emit` step must name it before a cancel or a restart drops it, and before the story ends. A story that forgets one fails ([Failures](#failures)).

## Cancels and anyOrder

`anyOrder` checks that the outcome doesn't depend on the order in which things happen. The steps after it run once for every order. Inside it, a `resolve` or `emit` is skipped when its command was cancelled earlier in the same order, just as a Loop drops a late message from a cancelled command.

<!-- snippet: test/docs/chat.test.ts#stops -->
```ts
const stops = Story.make(
	'a stop and a late delta land in either order',
	chat,
	story.given(ready(2)),
	story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	story.commands(ask),
	story.anyOrder(
		story.send(Stopped.make({})),
		// Skipped in the order where the stop cancelled `ask` first.
		story.emit(ask, Delta.make({ turn: 't1', text: 'Typed' }))
	),
	story.model(ready(2)),
	story.commands()
);
```

## Restarts

`restart()` round-trips the model through its Schema's JSON, drops every pending command and runs `resume`. The commands `resume` starts are owed like any others.

<!-- snippet: test/docs/chat.test.ts#resumes -->
```ts
const resumes = Story.make(
	'a restart asks again from the start',
	chat,
	story.given(ready(2)),
	story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	story.commands(ask),
	story.emit(ask, Delta.make({ turn: 't1', text: 'Typed' })),
	// The model goes through JSON, `ask` is dropped and `resume` asks again with an empty answer.
	story.restart(),
	story.model(Asking.make({ turns: [], left: 2, turn: 't1', question: 'Why Effect?', answer: '' })),
	story.commands(ask)
);
```

## Shared steps

`steps(...)` groups steps that several stories share. Build it once with the Program's builders and use it in any story about that Program. Inside `anyOrder`, a group moves as one step.

<!-- snippet: test/docs/chat.test.ts#shared -->
```ts
// A part several stories share, built once.
const asked = story.steps(
	story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	story.commands(ask)
);

const limited = Story.make(
	'a refusal at the limit locks the chat',
	chat,
	story.given(ready(2)),
	asked,
	story.resolve(ask, Refused.make({ turn: 't1', reason: 'LimitReached' })),
	story.satisfies('limited', Chat.guards.Limited)
);

const signedOut = Story.make(
	'a refusal for a signed-out user signs the chat out',
	chat,
	story.given(ready(2)),
	asked,
	story.resolve(ask, Refused.make({ turn: 't1', reason: 'SignedOut' })),
	story.model(SignedOut.make({}))
);
```

## Lines

`Story.lines(story)` renders a story as plain lines from its value alone, without running it. A group adds no line of its own, and an `anyOrder` is the line `any order` with its steps indented by two spaces. Records, failures and `covers` all speak in these lines.

<!-- snippet: test/docs/chat.test.ts#lines -->
```ts
expect(Story.lines(answers)).toEqual([
	'given Ready {"left":2,"turns":[]}',
	'send Asked {"text":"Why Effect?","turn":"t1"}',
	'commands Ask {"text":"Why Effect?","turn":"t1"}',
	'emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"Typed errors.","turn":"t1"}',
	'resolve Ask {"text":"Why Effect?","turn":"t1"} → Answered {"left":1,"turn":"t1"}',
	'commands SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
	'resolve SaveTurn {"answer":"Typed errors.","id":"t1","question":"Why Effect?"}',
	'model Ready {"left":1,"turns":[{"answer":"Typed errors.","id":"t1","question":"Why Effect?"}]}'
]);
expect(Story.lines(stops)).toEqual([
	'given Ready {"left":2,"turns":[]}',
	'send Asked {"text":"Why Effect?","turn":"t1"}',
	'commands Ask {"text":"Why Effect?","turn":"t1"}',
	'any order',
	'  send Stopped',
	'  emit Ask {"text":"Why Effect?","turn":"t1"} → Delta {"text":"Typed","turn":"t1"}',
	'model Ready {"left":2,"turns":[]}',
	'commands none'
]);
expect(Tale.lines(talks)).toEqual([
	'explore 100 runs of up to 30 steps, seed "any conversation keeps the chat valid", with restarts'
]);
```

## Running a story

`Story.run(story)` gives `Effect<Story.Outcome<Model>, Story.StoryFailure>`. The outcome is the final model, the same model as a line, and the sorted cases the story sent, produced or reached. `Vitest.stories` runs it for you ([vitest.md](vitest.md)); call `Story.run` yourself only to look at the outcome.

<!-- snippet: test/docs/chat.test.ts#outcome -->
```ts
const { model, final, cases } = yield* Story.run(limited);
expect(model).toEqual(Limited.make({ turns: [] }));
expect(final).toBe('Limited {"turns":[]}');
expect(cases).toEqual([
	'Command.Ask',
	'Message.Asked',
	'Message.Refused',
	'Model.Asking',
	'Model.Limited',
	'Model.Ready'
]);
```

## Failures

A failing story fails with a `Story.StoryFailure`. Its `message` is the whole failure, so a test runner shows it: the problem, then `step <n>: <line>`, then `actual: …` when there is nothing to diff it against. Its stack starts at the `Story.make` call, so the runner's code frame shows your story.

| Field | Meaning |
| --- | --- |
| `title` | The story's title. |
| `step` | The 1-based number of the failing line in `Story.lines(story)`. A failure at the end is `lines.length + 1`. |
| `line` | That line, or `end`. |
| `problem` | What went wrong. Inside an `anyOrder`, it starts with the failing order as the line numbers of its steps, such as `in order 5, 4: `. |
| `expected`, `actual` | The two sides as lines, when they differ. Vitest diffs them. |

<!-- snippet: test/docs/chat.test.ts#failure -->
```ts
const forgets = Story.make(
	'an answer is forgotten',
	chat,
	story.given(ready(2)),
	story.send(Asked.make({ turn: 't1', text: 'Why Effect?' })),
	story.commands(ask),
	story.resolve(ask, Answered.make({ turn: 't1', left: 1 }))
	// SaveTurn is never asserted.
);
const failure = yield* Effect.flip(Story.run(forgets));
expect(failure).toBeInstanceOf(Story.StoryFailure);
expect(failure).toMatchObject({
	title: 'an answer is forgotten',
	step: 5,
	line: 'end',
	problem: 'the story ended with 1 unasserted command(s)',
	actual: 'SaveTurn {"answer":"","id":"t1","question":"Why Effect?"}'
});
```

[strict-rules.md](strict-rules.md) lists every problem.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `of(program)` | `Builders<Model, Message, Command>` | The step builders above (`given`, `send`, `model`, `satisfies`, `commands`, `resolve`, `emit`, `restart`, `anyOrder`, `steps`), each giving a `Story.Step`. |
| `make(title, program, ...steps)` | function | Builds a `Story`. |
| `run(story)` | `Effect<Outcome<Model>, StoryFailure>` | Checks a story in memory. |
| `lines(story)` | `ReadonlyArray<string>` | The story as lines. |
| `Story<Model, Message, Command>` | class | A story value: `title`, `program`, `steps`. |
| `Step<Model, Message, Command>`, `Steps` | types | One step, and a list of them. |
| `Outcome<Model>` | interface | `{ model, final, cases }`. |
| `StoryFailure` | `Schema.TaggedError` | `{ title, step, line, problem, expected?, actual?, counterexample?, replay? }`. The last two are set only by explorations. |
