// A lamp whose model uses codecs (a bit for a boolean, an ISO string for a date) and whose
// variants break one strict rule each.
import { Schema } from 'effect';
import { Program } from '../../src/index.ts';

export const Lamp = Schema.Struct({
	on: Schema.BooleanFromBit,
	at: Schema.Date,
	count: Schema.Int
});
export type Lamp = typeof Lamp.Type;

export const Message = Schema.TaggedUnion({ Switched: { at: Schema.Date, by: Schema.Int } });
export type Message = typeof Message.Type;

export const Command = Schema.TaggedUnion({ Log: { text: Schema.NonEmptyString } });
export type Command = typeof Command.Type;

export const { Switched } = Message.cases;
export const { Log } = Command.cases;

export const lamp = Program.make({
	Model: Lamp,
	Message,
	Command,
	update: (current: Lamp, { at, by }: Message) => ({
		model: { on: !current.on, at, count: current.count + by }
	}),
	invariants: { countIsSmall: (current) => current.count < 10 }
});

export const off: Lamp = { on: false, at: new Date('2026-11-03T00:00:00.000Z'), count: 0 };
export const switched = (by = 1) => Switched.make({ at: new Date('2026-11-04T00:00:00.000Z'), by });

/** The lamp with another update, keeping its Schemas. */
export const variant = (update: (current: Lamp, message: Message) => Program.Next<Lamp, Command>) =>
	Program.make({ Model: Lamp, Message, Command, update });
