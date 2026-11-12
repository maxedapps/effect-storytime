# Strict rules

Every story, decision and explored path runs these rules at every step. They are built into `run`, so there is nothing to switch on ([ADR 0001](../adrs/0001-effect-native-story-library.md)).

## The rules

1. **Schema validity.** Every value a tale gives (the `given` model or state, each message and command) and every value the subject produces (models, commands, cancels, events, rejections, states) must satisfy its Schema. Values are checked on their Type side, so a `Schema.BooleanFromBit` field takes `true`, not `1`.
2. **Purity.** `update`, `resume`, `decide` and `evolve` each run twice on the same input. Their input must be unchanged afterwards, and both results must be equal by canonical JSON. A throw fails the step.
3. **JSON copies.** The model or state, and every message, command and event, must survive a round trip through its Schema's JSON unchanged. The run continues from the copy, so a callback that mutates a value it shares with the tale never changes the tale or the run.
4. **Invariants.** A Program's or Decider's invariants hold for every model or state, including every state a command's events pass through.
5. **Owed commands** (stories only). Every command `update` or `resume` produces is owed an assertion until a `commands`, `resolve` or `emit` step names it. A cancel or restart that drops an owed command fails, and so does a story that ends with one, in every order of an `anyOrder`. Explorations owe nothing, since a random path asserts no effects.

## Failure messages

A failure is a `Story.StoryFailure` whose `problem` is one of these. `<what>` is `the model`, `the message`, `the command`, `the state`, `the event` or `the rejection`, and `<fn>` is `update`, `resume`, `decide` or `evolve`.

| Message | Cause | Fix |
| --- | --- | --- |
| `<what> is invalid: …` | A value breaks its Schema. | Build values with the union's `make`, and check the function that produced it. |
| `<what> is not JSON: …` | The Schema can't encode the value. | Use encodable field types. |
| `<what> does not survive JSON: …`, `<what> changes through JSON` | Encoding and decoding gives a different value. | Make the Schema a faithful codec: no lossy transforms, no class instances. |
| `<fn> threw: …` | The function threw. | Return a rejection or a model for the case instead of throwing. |
| `<fn> changed its input` | The function mutated the state, model, command or message. | Spread into a new value. |
| `<fn> gave two results for the same input` | The function read the clock, randomness or mutable state. | Pass that value in through the command or message. |
| `invariant <name> does not hold` | A model or state breaks an invariant. `actual` shows it. | Fix `update`, `evolve` or `decide`, or the invariant. |
| `invariant <name> threw: …` | The invariant itself threw. | Guard the predicate for every case of the model. |
| `a story starts with given(model)`, `a decision starts with given(state)` | The first step isn't `given`. | Start with `given`. |
| `given(model) comes once, first`, `given(state) comes once, first` | A second `given`. | Split the tale, or use `restart()`. |
| `the stored state differs from given` | `Decision.against` loaded a state under the key that isn't the `given` one. | Arrange the Store's rows first, or use a fresh key. |
| `the model differs`, `the state differs` | `model(...)` or `state(...)` doesn't match. | Compare `expected` with `actual`. |
| `the model does not satisfy <label>`, `the state does not satisfy <label>` | A `satisfies` check failed. | |
| `the pending commands differ` | `commands(...)` doesn't list exactly the pending commands. | Compare `expected` with `actual`, one command per line. |
| `<command> is not pending` | `resolve` or `emit` names a command that isn't pending. | Check that the command's fields match exactly; identity is canonical JSON. |
| `<command> was cancelled before any step asserted it` | `cancels` dropped an owed command. | Assert it with `commands(...)` before the step that cancels it. |
| `the restart drops commands no step asserted` | `restart()` with owed commands. | Assert them first. |
| `the story ended with N unasserted command(s)` | Commands still owed at the end. `actual` lists them. | Add `commands`, `resolve` or `emit` steps for them. |
| `anyOrder takes 2 to 5 steps` | An `anyOrder` with fewer than 2 or more than 5 steps. | Group steps with `steps(...)`, or split the story. |
| `the command was rejected`, `the command was accepted` | The decision expected the other outcome. | |
| `the events differ`, `the rejection differs` | The outcome matched, its content didn't. | Events must match exactly and in order. |
| `a when needs accepted(...) or rejected(...) right after it` | A `when` without its outcome. | |
| `accepted(...) comes right after a when`, `rejected(...) comes right after a when` | An outcome without its `when`. | |

Inside an `anyOrder`, a story's message starts with `in order <line numbers>: `, naming the order that failed.
