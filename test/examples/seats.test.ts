// #region quickstart
// seats.test.ts: tales about the domain, told as Vitest tests.
import { describe } from '@effect/vitest';
import { Decision, Story, Vitest } from 'effect-storytime/testing';
import { Event, Form, Message, Rejection, Request, Command, form, seats } from './seats.ts';

const { Book, Cancel } = Command.cases;
const { Booked, Cancelled } = Event.cases;
const { BookSeat } = Request.cases;

// A decision: given a state, each command is accepted with its events or rejected.
const sellsOut = Decision.make(
	'the last seat sells out',
	seats,
	Decision.given({ capacity: 2, guests: ['ada'] }),
	Decision.when(Book.make({ guest: 'bo' })),
	Decision.accepted(Booked.make({ guest: 'bo' })),
	Decision.when(Book.make({ guest: 'cy' })),
	Decision.rejected(Rejection.cases.SoldOut.make({})),
	Decision.when(Cancel.make({ guest: 'ada' })),
	Decision.accepted(Cancelled.make({ guest: 'ada' })),
	Decision.state({ capacity: 2, guests: ['bo'] })
);

// A story: messages go in, and every command the Program asks for is asserted.
const books = Story.make(
	'a submitted form books a seat',
	form,
	Story.given(Form.cases.Editing.make({})),
	Story.send(Message.cases.Submitted.make({ guest: 'ada' })),
	Story.commands(BookSeat.make({ guest: 'ada' })),
	Story.resolve(BookSeat.make({ guest: 'ada' }), Message.cases.Succeeded.make({})),
	Story.model(Form.cases.Done.make({ guest: 'ada' }))
);

describe('seats', () => {
	Vitest.stories(sellsOut, books);
});
// #endregion quickstart
