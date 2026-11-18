# Tales and covers

`import { Tale } from 'effect-storytime/testing'`

A tale is a story, a decision or an exploration. `Tale` works on any of them, so tools and the Vitest adapter treat all three alike. It also proves that a subject's invariants can fail.

| Export | Kind | Meaning |
| --- | --- | --- |
| `lines(tale)` | `ReadonlyArray<string>` | The tale's lines, from its value alone. An exploration has one line. |
| `run(tale)` | `Effect<Reached, StoryFailure>` | Runs the tale in memory. |
| `cases(subject)` | `ReadonlyArray<string>` | Every case a Program or a Decider has. |
| `covers(subject, tales)` | `Effect<void, StoryFailure \| Uncovered>` | Runs the tales and requires them to touch every case of the subject between them. |
| `breaks(subject, states)` | `Effect<void, Unbroken>` | Requires each invariant of the subject to break on the state given for it, and only that invariant. |
| `Tale` | interface | `{ _tag: 'Story' \| 'Exploration' \| 'Decision', title }`, plus the protocol the three implement. |
| `Reached` | interface | `{ final?, finals?, cases }`, what a passing tale reached: a decision's `final` state as a line, or a story's `finals`, one `{ order, final }` per order. Explorations have neither. |
| `Uncovered` | `Schema.TaggedError` | `{ missing }`, message `no tale touches <cases>`. |
| `Unbroken` | `Schema.TaggedError` | `{ invariant, problem, actual? }`, message `breaking invariant <name>: <problem>`. |
| `Judged<Value, Name>` | type | A Program or a Decider with invariants named `Name` on its `Value`, the subject `breaks` takes. |
| `Breaking<Value, Name>` | type | `{ [name]: value }`, one model or state per invariant name. |

## Cases

`Tale.cases(subject)` lists cases as `Role.Tag`, from each of the subject's Schemas that is a tagged union:

- A Program: `Model.X` (only when the Model is a tagged union), `Message.X` and `Command.X`.
- A Decider: `State.X`, `Command.X`, `Event.X` and `Rejection.X`, each only when that Schema is a tagged union.

A tale touches a case when it sends, produces or reaches it. A story touches the messages it sends, the commands produced and every model reached. A decision touches its commands, the events and rejections they give, and every state a command's events pass through, so a state that one command enters and leaves still counts.

## covers

`Tale.covers(subject, tales)` runs every tale and fails with `Uncovered { missing }` unless the tales together touch every case of the subject. A failing tale fails `covers` with its `StoryFailure`.

Only the subject's own tales count. A tale about another Program or Decider touches none of this subject's cases, even when the case names match ([ADR 0002](https://github.com/maxedapps/effect-storytime/blob/main/adrs/0002-decider-explorations-and-covers.md)). So pass a Program's stories and explorations to its `covers`, and a Decider's decisions and explorations to its own.

An `Uncovered` failure names a case no tale reaches. Add a story or decision for it, or widen an exploration's `send`, `replies` or `given`. A case that nothing can reach is dead code: remove it from the Schema.

In a test file, use `Vitest.covers(subject, tales)`, which registers this as a test ([vitest.md](vitest.md)).

### What covers proves

`covers` proves that every case is reached, not that every rule is tested. One rejection case can stand for several rules: if `decide` rejects a `Grant` with `NotActive` for two different reasons, one decision reaching `Rejection.NotActive` covers the case while the other rule goes untested. Write a tale per rule, grouped as [vitest.md](vitest.md#one-describe-per-rule) shows, and let mutation testing (Stryker, say) find the rules no tale pins down: a mutant that flips a condition and survives every tale names one.

## breaks

An invariant that can never be false passes every tale, and so does one that only ever breaks together with another. `Tale.breaks(subject, states)` takes one model or state per invariant, keyed by its name, and fails with `Unbroken` unless each one breaks its own invariant and no other. The type requires exactly the subject's invariant names, so adding an invariant fails to compile until it has a state.

Each state runs the strict rules for a given value: it must be valid by its Schema and survive its JSON round trip, and every invariant must leave it unchanged and not throw ([strict-rules.md](strict-rules.md)). An `Unbroken` failure names the invariant and the problem:

| Problem | Cause | Fix |
| --- | --- | --- |
| `the state holds it` | The state keeps its invariant. | Give a state that breaks it, or remove an invariant that nothing can break. |
| `the state breaks <names> too` | The state breaks other invariants as well. | Give a state that breaks only this one. When none exists, the invariant repeats another: merge them. |
| `no state given` | The subject's type was widened, so a name is missing at runtime. | Keep the subject's inferred type, or give every name. |

For a Program the problems say `the model` instead. A subject without invariants takes `{}`. In a test file, use `Vitest.breaks(subject, states)` ([vitest.md](vitest.md)).
