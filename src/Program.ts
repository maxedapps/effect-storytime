/**
 * A Program is a pure state machine: `update` turns a model and a message into the next model
 * and the commands to run. Commands are Schema data; a Loop runs them, a story asserts them.
 */
import { Schema } from 'effect';

/** A value with a `_tag`, such as a case of `Schema.TaggedUnion`. */
export interface Tagged {
	readonly _tag: string;
}

/** A Schema of tagged values that lists its cases, such as `Schema.TaggedUnion`. */
export interface Cases<A extends Tagged> extends Schema.Codec<A, unknown> {
	readonly cases: Readonly<Record<string, Schema.Constraint>>;
}

/** What `update` and `resume` return: the next model, the commands to start and those to stop. */
export interface Next<Model, Command> {
	readonly model: Model;
	readonly commands?: ReadonlyArray<Command>;
	readonly cancels?: ReadonlyArray<Command>;
}

/**
 * Named predicates every model or state must satisfy. A Loop checks a Program's on every model
 * before it keeps it, `Decider.handle` a Decider's on the state each command reaches, and every
 * tale checks them at each step.
 */
export type Invariants<Model, Name extends string = string> = Readonly<
	Record<Name, (model: Model) => boolean>
>;

/**
 * The defect a Loop or `Decider.handle` dies with when a model or state breaks an invariant. It
 * dies before anything is saved, published or started.
 */
export class InvariantBroken extends Schema.TaggedError<InvariantBroken>()('InvariantBroken', {
	invariant: Schema.String,
	/** The model or state as a line, as stories show it. */
	state: Schema.String
}) {
	override get message() {
		return `invariant ${this.invariant} does not hold for ${this.state}`;
	}
}

/**
 * The defect a Loop or `Decider.handle` dies with when an invariant changes the model or state it
 * checks, which must leave it alone. It dies before anything is saved, published or started.
 */
export class InvariantChanged extends Schema.TaggedError<InvariantChanged>()('InvariantChanged', {
	invariant: Schema.String,
	/** The model or state's canonical JSON before and after the invariant ran. */
	before: Schema.String,
	after: Schema.String
}) {
	override get message() {
		return `invariant ${this.invariant} changed ${this.before} to ${this.after}`;
	}
}

export interface Program<
	Model,
	Message extends Tagged,
	Command extends Tagged,
	/** The names of its invariants. */
	Name extends string = string
> {
	readonly Model: Schema.Codec<Model, unknown>;
	readonly Message: Cases<Message>;
	readonly Command: Cases<Command>;
	readonly update: (model: Model, message: Message) => Next<Model, Command>;
	/** What to redo after a restart, from the stored model alone. */
	readonly resume: (model: Model) => Next<Model, Command>;
	readonly invariants: Invariants<Model, Name>;
}

export interface Definition<
	Model,
	Message extends Tagged,
	Command extends Tagged,
	Name extends string
> {
	readonly Model: Schema.Codec<Model, unknown>;
	readonly Message: Cases<Message>;
	readonly Command: Cases<Command>;
	readonly update: (model: Model, message: Message) => Next<Model, Command>;
	readonly resume?: (model: Model) => Next<Model, Command>;
	readonly invariants?: Invariants<Model, Name>;
}

const unchanged = <Model>(model: Model) => ({ model });

export const make = <
	Model,
	Message extends Tagged,
	Command extends Tagged,
	Name extends string = never
>(
	definition: Definition<Model, Message, Command, Name>
): Program<Model, Message, Command, Name> => ({
	...definition,
	resume: definition.resume ?? unchanged,
	// SAFETY: `Name` is inferred from the invariants given, so a definition without any has none
	// to name (`never`), and the empty record holds all of them.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TypeScript can't tie a missing property to `Name`
	invariants: definition.invariants ?? ({} as Invariants<Model, Name>)
});
