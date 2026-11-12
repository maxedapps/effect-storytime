// #region quickstart
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
// #endregion quickstart
