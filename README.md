# effect-storytime

effect-storytime is two libraries for Effect 4 in one package:

- **A domain-driven design library** (`effect-storytime`). You write a domain as pure state machines whose inputs, outputs and side effects are Schema data. A **Decider** holds the rules of one consistency boundary: `decide(state, command)` gives events or a rejection, `evolve` folds them into the state, and named invariants say which states may exist. `Decider.handle` runs it on your **Store** in one transaction, which makes it an aggregate. A **Program** holds a process or UI state: `update(model, message)` gives the next model and the commands to start or cancel, and a **Loop** runs it with Effect: your handlers run its commands, their answers go back into `update`, and a store commits each model with its writes until the process settles. `handle` and a Loop both refuse a state or model that breaks an invariant before they save it.
- **A story-based testing library** (`effect-storytime/testing`). You tell tales about the domain: **stories** about Programs, **decisions** about Deciders and **explorations** that generate random paths through either, check named properties on every step and shrink a failing one to a short counterexample. Every tale runs strict rules at every step (Schema validity, purity, JSON round trips, invariants, and an assertion for every command), and **covers** requires a subject's tales to touch every case it has. A **Vitest** adapter (`effect-storytime/vitest`) runs tales as tests and writes a deterministic JSON record of every tale told.

The documentation is written for coding agents that use the library in their own projects. Start with [docs/README.md](docs/README.md).

## Install

Install it from its git tag, which carries the built `dist/`, so installing runs no build. Pin it in your pnpm catalog:

```yaml
# pnpm-workspace.yaml
catalog:
  effect-storytime: github:maxedapps/effect-storytime#v0.4.0
```

`effect` (4.1.2 or newer) is the one required peer. Where you test with Vitest, add `vitest` (5.1) and `@effect/vitest` (4.1.2), which only the `effect-storytime/vitest` entry loads. The domain entry imports nothing from the testing entries, so production code loads none of it, and `effect-storytime/testing` loads neither Vitest nor Node's `fs`.

## Quick start: the domain

A Decider for the seats of an event and a Program for the form that books one. Every value is Schema data, and every function is pure.

<!-- snippet: test/examples/seats.ts#quickstart -->
```ts
// seats.ts: the domain.
import { Result, Schema } from 'effect';
import { Decider, Program } from 'effect-storytime';

// A Decider holds the rules of one consistency boundary: the seats of one event.
export const Seats = Schema.Struct({ capacity: Schema.Int, guests: Schema.Array(Schema.String) });
export const Command = Schema.TaggedUnion({
	Book: { guest: Schema.String },
	Cancel: { guest: Schema.String }
});
export const Event = Schema.TaggedUnion({
	Booked: { guest: Schema.String },
	Cancelled: { guest: Schema.String }
});
export const Rejection = Schema.TaggedUnion({
	SoldOut: {},
	AlreadyBooked: { guest: Schema.String },
	NotBooked: { guest: Schema.String }
});
const { Booked, Cancelled } = Event.cases;
const { SoldOut, AlreadyBooked, NotBooked } = Rejection.cases;

export const seats = Decider.make({
	State: Seats,
	Command,
	Event,
	Rejection,
	initial: { capacity: 2, guests: [] },
	decide: (state, command) =>
		Command.match(command, {
			Book: ({ guest }) => {
				if (state.guests.includes(guest)) return Result.fail(AlreadyBooked.make({ guest }));
				if (state.guests.length >= state.capacity) return Result.fail(SoldOut.make({}));
				return Result.succeed([Booked.make({ guest })]);
			},
			Cancel: ({ guest }) =>
				state.guests.includes(guest)
					? Result.succeed([Cancelled.make({ guest })])
					: Result.fail(NotBooked.make({ guest }))
		}),
	evolve: (state, event) =>
		Event.match(event, {
			Booked: ({ guest }) => ({ ...state, guests: [...state.guests, guest] }),
			Cancelled: ({ guest }) => ({
				...state,
				guests: state.guests.filter((booked) => booked !== guest)
			})
		}),
	invariants: { withinCapacity: (state) => state.guests.length <= state.capacity }
});

// A Program holds the state of a process or a screen: here, a booking form.
export const Form = Schema.TaggedUnion({
	Editing: {},
	Sending: { guest: Schema.String },
	Done: { guest: Schema.String },
	Refused: { reason: Schema.String }
});
export const Message = Schema.TaggedUnion({
	Submitted: { guest: Schema.String },
	Succeeded: {},
	Failed: { reason: Schema.String }
});
export const Request = Schema.TaggedUnion({ BookSeat: { guest: Schema.String } });
const { Sending, Done, Refused } = Form.cases;
const { BookSeat } = Request.cases;

export const form = Program.make({
	Model: Form,
	Message,
	// Commands are data the Program asks for; a Loop runs them, a story asserts them.
	Command: Request,
	update: (model, message) =>
		Message.match(message, {
			Submitted: ({ guest }) =>
				Form.guards.Sending(model)
					? { model }
					: { model: Sending.make({ guest }), commands: [BookSeat.make({ guest })] },
			Succeeded: () =>
				Form.guards.Sending(model) ? { model: Done.make({ guest: model.guest }) } : { model },
			Failed: ({ reason }) => ({ model: Refused.make({ reason }) })
		})
});
```

Run the Decider with `Decider.handle(seats, SeatStore)`, where `SeatStore` is your app's Store service ([docs/decider.md](docs/decider.md)), and the Program with `Loop.make(form, { init, handler })`, or with `Loop.run` when it runs to an end ([docs/loop.md](docs/loop.md)).

## Quick start: the tales

The tests for that domain: a decision about the Decider, a story about the Program and an exploration that checks random paths through it, registered as Vitest tests with a coverage check.

<!-- snippet: test/examples/seats.test.ts#quickstart -->
```ts
// seats.test.ts: tales about the domain, told as Vitest tests.
import { describe } from '@effect/vitest';
import { Arbitrary } from 'effect';
import { Decision, Exploration, Story } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import { Command, Event, Form, Message, Rejection, Request, form, seats } from './seats.ts';

const { Book, Cancel } = Command.cases;
const { Booked, Cancelled } = Event.cases;
const { Submitted, Succeeded, Failed } = Message.cases;
const { BookSeat } = Request.cases;

// Step builders, typed by the Decider and the Program they tell about.
const decision = Decision.of(seats);
const story = Story.of(form);

// A decision: given a state, each command is accepted with its events or rejected.
const sellsOut = Decision.make(
	'the last seat sells out',
	seats,
	decision.given({ capacity: 2, guests: ['ada'] }),
	decision.when(Book.make({ guest: 'bo' })),
	decision.accepted(Booked.make({ guest: 'bo' })),
	decision.when(Book.make({ guest: 'cy' })),
	decision.rejected(Rejection.cases.SoldOut.make({})),
	decision.when(Cancel.make({ guest: 'ada' })),
	decision.accepted(Cancelled.make({ guest: 'ada' })),
	decision.state({ capacity: 2, guests: ['bo'] })
);

// A story: messages go in, and every command the Program asks for is asserted.
const books = Story.make(
	'a submitted form books a seat',
	form,
	story.given(Form.cases.Editing.make({})),
	story.send(Submitted.make({ guest: 'ada' })),
	story.commands(BookSeat.make({ guest: 'ada' })),
	story.resolve(BookSeat.make({ guest: 'ada' }), Succeeded.make({})),
	story.model(Form.cases.Done.make({ guest: 'ada' }))
);

// An exploration: 100 random paths of messages, replies and restarts, each checked with the
// strict rules (Schemas, purity, JSON round trips, invariants). A failure shrinks to a short story.
const anyPath = Exploration.make('any submission leaves the form valid', form, {
	given: Arbitrary.Constant(Form.cases.Editing.make({})),
	// The messages a pending BookSeat may answer with.
	replies: () => [Succeeded.make({}), Failed.make({ reason: 'sold out' })]
});

describe('seats', () => {
	// One test per tale, named by its title.
	Vitest.stories(sellsOut, books, anyPath);
	// One test: the form's tales together send, produce or reach every case it has.
	Vitest.covers(form, [books, anyPath]);
});
```

Each tale is a test named by its title. Its failure message names the step and line that broke a rule, with `expected` and `actual` for Vitest to diff, and Vitest's code frame points at the tale. A failing exploration's message shows its shrunk path as story lines and the token that replays it. `covers` fails with the cases no tale touches.

Add the reporter to `vitest.config.ts`, and every run writes the story record, a deterministic JSON file with every tale's lines, status, final models and cases ([docs/story-record.md](docs/story-record.md)):

<!-- snippet: test/examples/vitest.config.ts#config -->
```ts
import { Vitest } from 'effect-storytime/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		reporters: ['default', new Vitest.Reporter({ outputFile: 'reports/stories.json' })]
	}
});
```

[docs/stories.md](docs/stories.md), [docs/decisions.md](docs/decisions.md), [docs/explorations.md](docs/explorations.md) and [docs/vitest.md](docs/vitest.md) cover every step and option.

## Documentation

| Page | Covers |
| --- | --- |
| [docs/README.md](docs/README.md) | The entries, the terms and the example domains. |
| [docs/domain-modelling.md](docs/domain-modelling.md) | DDD building blocks, choosing a Decider or a Program, rules for Schemas and functions. |
| [docs/decider.md](docs/decider.md) | `Decider.make`, `handle`, the Store contract, Stores on `effect/sql` and in memory. |
| [docs/program.md](docs/program.md) | `Program.make`, `Next`, `resume` and invariants. |
| [docs/loop.md](docs/loop.md) | `Loop.run`, `Loop.make`, handlers with typed errors, writes, the store, `settled`, invariants and moving a hand-written driver. |
| [docs/stories.md](docs/stories.md) | Story steps, `anyOrder` and its finals, `restart`, shared steps, lines and failures. |
| [docs/decisions.md](docs/decisions.md) | Decision steps, `run` and `against` a real Store. |
| [docs/explorations.md](docs/explorations.md) | Generated paths through Programs and Deciders, properties, counterexamples and replay. |
| [docs/strict-rules.md](docs/strict-rules.md) | What every tale checks, and every failure message. |
| [docs/tales-and-covers.md](docs/tales-and-covers.md) | `Tale`, cases and `covers`. |
| [docs/vitest.md](docs/vitest.md) | `Vitest.stories`, `covers`, `tell` and the `Reporter`. |
| [docs/story-record.md](docs/story-record.md) | The JSON report and `StoryRecord.decode`. |
| [docs/recipes.md](docs/recipes.md) | A process manager that survives a crash, testing a database Store, fixing a counterexample. |
| [docs/pitfalls.md](docs/pitfalls.md) | Type errors and failures that surprise. |

The design decisions are in [`adrs/`](adrs).

## Development

`pnpm check` is the gate: formatting, lint, types, tests at 100% coverage, a 100% mutation score with Stryker and the build. Every TypeScript block in this README and in `docs/` is a region of a checked file, kept in sync by `test/snippets.test.ts`. [AGENTS.md](AGENTS.md) has the rest.

## License

MIT
