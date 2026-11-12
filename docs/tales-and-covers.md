# Tales and covers

`import { Tale } from 'effect-storytime/testing'`

A tale is a story, a decision or an exploration. `Tale` works on any of them, so tools and the Vitest adapter treat all three alike.

| Export | Kind | Meaning |
| --- | --- | --- |
| `lines(tale)` | `ReadonlyArray<string>` | The tale's lines, from its value alone. An exploration has one line. |
| `run(tale)` | `Effect<Reached, StoryFailure>` | Runs the tale in memory. |
| `cases(subject)` | `ReadonlyArray<string>` | Every case a Program or a Decider has. |
| `covers(subject, tales)` | `Effect<void, StoryFailure \| Uncovered>` | Runs the tales and requires them to touch every case of the subject between them. |
| `Tale` | interface | `{ _tag: 'Story' \| 'Exploration' \| 'Decision', title }`, plus the protocol the three implement. |
| `Reached` | interface | `{ final?, cases }`, what a passing tale reached. Explorations have no `final`. |
| `Uncovered` | `Schema.TaggedError` | `{ missing }`, message `no tale touches <cases>`. |

## Cases

`Tale.cases(subject)` lists cases as `Role.Tag`, from each of the subject's Schemas that is a tagged union:

- A Program: `Model.X` (only when the Model is a tagged union), `Message.X` and `Command.X`.
- A Decider: `State.X`, `Command.X`, `Event.X` and `Rejection.X`, each only when that Schema is a tagged union.

A tale touches a case when it sends, produces or reaches it. A story touches the messages it sends, the commands produced and every model reached. A decision touches its commands, the events and rejections they give, and every state a command's events pass through, so a state that one command enters and leaves still counts.

## covers

`Tale.covers(subject, tales)` runs every tale and fails with `Uncovered { missing }` unless the tales together touch every case of the subject. A failing tale fails `covers` with its `StoryFailure`.

Only the subject's own tales count. A tale about another Program or Decider touches none of this subject's cases, even when the case names match ([ADR 0002](../adrs/0002-decider-explorations-and-covers.md)). So pass a Program's stories and explorations to its `covers`, and a Decider's decisions and explorations to its own.

An `Uncovered` failure names a case no tale reaches. Add a story or decision for it, or widen an exploration's `send`, `replies` or `given`. A case that nothing can reach is dead code: remove it from the Schema.

In a test file, use `Vitest.covers(subject, tales)`, which registers this as a test ([vitest.md](vitest.md)).
