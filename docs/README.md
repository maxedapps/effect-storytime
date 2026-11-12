# effect-storytime documentation

These pages are for coding agents that build a domain with effect-storytime and test it with tales. Each page covers one topic completely, so read the one your task touches.

Every TypeScript block here is a region of a file in this repository, marked by an HTML comment such as `<!-- snippet: test/examples/chat.ts#update -->` above it. Those files are type-checked, linted and run by the test suite, and `test/snippets.test.ts` fails when a block differs from its region. The code shown is the code that runs against the current API, and you can open the named file to see the rest of it.

## The two entries

| Import | Modules | Use it in |
| --- | --- | --- |
| `effect-storytime` | `Decider`, `Program`, `Loop` | production code |
| `effect-storytime/testing` | `Story`, `Decision`, `Exploration`, `Tale`, `Vitest`, `StoryRecord` | tests and tools |

Each module is a namespace (`Decider.make`, `Story.of`, `Vitest.Reporter`). The domain entry imports nothing from `testing`, so production code loads none of it. `effect` 4.1.2 or newer is the one required peer; the testing entry also needs `vitest` 5.1 and `@effect/vitest` 4.1.2.

## Pages

| Page | Read it when you |
| --- | --- |
| [domain-modelling.md](domain-modelling.md) | decide where a rule lives: a Decider, a Program, a Store or plain Effect |
| [decider.md](decider.md) | write the command side of a consistency boundary and the Store it runs on |
| [program.md](program.md) | write a process, a workflow step or UI state as a pure state machine |
| [loop.md](loop.md) | run a Program with real effects and keep its model across restarts |
| [stories.md](stories.md) | test a Program step by step |
| [decisions.md](decisions.md) | test a Decider, in memory or through its real Store |
| [explorations.md](explorations.md) | check random paths through a Program or a Decider |
| [strict-rules.md](strict-rules.md) | need to know what every tale checks, or read a failure message |
| [tales-and-covers.md](tales-and-covers.md) | run any tale, list a subject's cases or require every case to be touched |
| [vitest.md](vitest.md) | register tales as tests and write the story record |
| [story-record.md](story-record.md) | read the JSON report a test run writes |
| [recipes.md](recipes.md) | build a process manager that drives a Decider and survives a crash |
| [pitfalls.md](pitfalls.md) | hit a type error or a failure you don't understand |

## Terms

- **Tale**: a story (about a Program), a decision (about a Decider) or an exploration (generated paths through either).
- **Subject**: the Program or Decider a tale is about.
- **Canonical JSON**: a value encoded by its Schema to JSON, with object keys sorted. Tales compare values by it, a command is identified by it (two commands with the same canonical JSON are the same command), and lines show it. It is the encoded side, so a `Schema.BooleanFromBit` field shows as `1`.
- **Line**: a step as text, such as `send Asked {"text":"Why Effect?","turn":"t1"}`. A tagged value shows as its tag followed by its other fields as canonical JSON, or as the tag alone when it has no other fields (`send Stopped`). An untagged value shows as its canonical JSON.
- **Case**: one member of a subject's tagged unions, written `Role.Tag`: `Model.Ready`, `Message.Asked` and `Command.Ask` for a Program, `State.X`, `Command.Grant`, `Event.Granted` and `Rejection.NotActive` for a Decider.

## The examples

The pages share a few example domains, all in `test/examples/` and `test/docs/`:

- **membership** (`test/examples/membership.ts`): a Decider for a course membership that is granted, checked against a store and revoked, with an in-memory Store service.
- **chat** (`test/examples/chat.ts`): a Program for a chat that asks one question at a time, streams the answer, has a daily limit and handles refusals.
- **awarding** (`test/examples/awarding.ts`): a process manager that awards badges through a badges Decider and reissues pending awards after a restart.
- **seats** (`test/examples/seats.ts`): the README's quick start, a small Decider and Program.

## Why it is built this way

The ADRs in [`adrs/`](../adrs) record the design:

- [0001](../adrs/0001-effect-native-story-library.md): tales are Effect values with strict rules built into every run, and the Vitest adapter is optional.
- [0002](../adrs/0002-decider-explorations-and-covers.md): explorations of Deciders, a Decider's cases, and why `covers` counts only the subject's own tales.
- [0003](../adrs/0003-lean-domain-library.md): a Decider is the command side and a Program the process manager, with no aggregate, repository or event store types. It also sets the Store contract and the two entries.
