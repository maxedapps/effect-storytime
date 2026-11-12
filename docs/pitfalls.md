# Pitfalls

## Types

- **A shared `Story.steps(...)` infers `never`.** Outside `Story.make` nothing tells it the Program's types, so every step in it fails to type-check. Name them: `Story.steps<Chat, Message, Command>(...)` ([stories.md](stories.md#shared-steps)). The same goes for any step built outside `make`.
- **`Message` or `Command` isn't a `Program.Cases`.** A Program's `Message` and `Command` must list their `cases`. A `Schema.TaggedStruct`, a `Schema.Union` of structs or a plain struct doesn't, so wrap it: `Schema.TaggedUnion({ Award: { ... } })`.
- **A Store's error type.** `Decider.Store<Key, State, Event, E>` defaults `E` to `never`. A database Store names its errors, such as `SqlError.SqlError | Schema.SchemaError`, and `handle` and `Decision.against` pass them on.
- **A handler that can fail doesn't type-check.** `Loop`'s handler has the error type `never`. Turn every failure into a message the Program handles.
- **`persist` with errors doesn't type-check.** Its `load` and `save` have the error type `never` too: `Effect.orDie` the infrastructure errors.

## Failing tales

- **`<fn> gave two results for the same input`.** The function read the clock, a random number or mutable state. Put the value into the command or message.
- **`<fn> changed its input`.** The function mutated its argument, often with `push` or by assigning a field. Spread into a new value.
- **`… changes through JSON`.** A Schema's encoding loses something its decoding can't restore, or a value holds something JSON can't carry, such as a class instance.
- **Owed commands.** Every command `update` or `resume` produces must be asserted by `commands`, `resolve` or `emit` before a cancel or restart drops it and before the story ends. A command that answers with no message still needs `resolve(command)`.
- **`commands(...)` lists all pending commands.** It requires exactly the pending set, so list every pending command, or write `commands()` for none.
- **Identity is canonical JSON.** `resolve` and `emit` find a pending command by all of its fields, and a Program cancels by the full value. Two commands that differ in any field are different commands, and two identical commands are one.
- **`given` first and only once.** A second `given` fails. Use `restart()` to continue from a stored model, or write another tale.
- **`anyOrder` takes 2 to 5 steps.** Group steps with `Story.steps(...)` to move them as one.
- **A `when` needs its outcome right after it.** `Decision.when(...)` must be followed by `accepted(...)` or `rejected(...)`.
- **`Decision.against` doesn't seed.** It loads the state under the key and fails with `the stored state differs from given` unless the test arranged it. Tests that share one `layer` share the Store, so use a key per test.

## Explorations

- **No Arbitrary for the default `send`.** `Exploration.make` derives `Arbitrary.schema(program.Message)` when `send` is missing, and throws if the Schema can't be generated. Pass `send`.
- **A wide `send` explores little.** Random strings rarely meet: an `Answered` for turn `"x7#"` never matches the pending `Ask`. Generate from a few fixed values so messages about the same thing meet.
- **`replies` decide what completes.** A command with no replies stays pending forever on that path. Give each streaming command its `emits`, too.
- **`Arbitrary` has no `oneOf`.** Generate a `Schema.Literals` and `Arbitrary.map` it to the values.

## Coverage

- **Only the subject's own tales count.** `covers(chat, [lifecycle])` counts nothing, since `lifecycle` is about another subject.
- **One `covers` per `describe`.** `Vitest.covers` always registers a test named `its tales touch every case`, so two in one `describe` share a name.
- **A struct Model or State has no cases.** Only tagged unions add `Model.X` or `State.X`.

## Runtime

- **`handle` inside another transaction.** A nested transaction keeps the outer isolation and commits only with it, so `handle` resolves before its changes are durable. Call `handle` outside any transaction.
- **An invariant breaks in production.** `handle` dies with `Decider.InvariantBroken` and saves nothing. It's a defect: fix `decide` or `evolve`, and add a decision that reproduces it.
- **The Loop checks nothing.** It runs `update` as it is, without Schema, purity or invariant checks. Those happen only in tales, so test every Program with stories and an exploration.
- **`dispatch` doesn't wait for commands.** It completes once the model is updated. Wait for a model on `changes` to see a command's effect.
