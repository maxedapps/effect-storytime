// #region quickstart
// seats.test.ts: tales about the domain, told as Vitest tests.
import { describe } from '@effect/vitest';
import { Arbitrary } from 'effect';
import { Decision, Exploration, Story, Vitest } from 'effect-storytime/testing';
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
// #endregion quickstart
