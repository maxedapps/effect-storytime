/**
 * A decision tells how a Decider rules, as steps: start from a state, send inputs and name the
 * events or the rejection each one gives. `run` checks it in memory with the strict rules,
 * `against` through `handle`'s transaction on a real Store.
 */
import { Data, Effect, Option, Ref, Result } from 'effect';
import type { Context } from 'effect';
import type { Decider, Store } from './Decider.ts';
import { describer, stringifier } from './internal/canonical.ts';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import { attempt, conforms, holds, Problem, pure, roundTrips } from './internal/check.ts';
import { decideIn, loadOrInitial } from './internal/store.ts';
import { StoryFailure } from './Story.ts';

export type Step<State, Input, Event, Rejection> = Data.TaggedEnum<{
	Given: { readonly state: State };
	When: { readonly input: Input };
	Accepted: { readonly events: ReadonlyArray<Event> };
	Rejected: { readonly rejection: Rejection };
	State: { readonly expected: State };
	Satisfies: { readonly label: string; readonly check: (state: State) => boolean };
}>;

interface StepDefinition extends Data.TaggedEnum.WithGenerics<4> {
	readonly taggedEnum: Step<this['A'], this['B'], this['C'], this['D']>;
}

const Step = Data.taggedEnum<StepDefinition>();

/** Starts the decision from a state. It comes first and only once. */
export const given = <State = never, Input = never, Event = never, Rejection = never>(
	state: NoInfer<State>
): Step<State, Input, Event, Rejection> => Step.Given({ state });

/** Decides an input. The next step names its events or its rejection. */
export const when = <State = never, Input = never, Event = never, Rejection = never>(
	input: NoInfer<Input>
): Step<State, Input, Event, Rejection> => Step.When({ input });

/** Requires the input to give exactly these events, in this order; `accepted()` means none. */
export const accepted = <State = never, Input = never, Event = never, Rejection = never>(
	...events: ReadonlyArray<NoInfer<Event>>
): Step<State, Input, Event, Rejection> => Step.Accepted({ events });

/** Requires the input to be rejected with `rejection`. */
export const rejected = <State = never, Input = never, Event = never, Rejection = never>(
	rejection: NoInfer<Rejection>
): Step<State, Input, Event, Rejection> => Step.Rejected({ rejection });

/** Requires the state to equal `expected`. */
export const state = <State = never, Input = never, Event = never, Rejection = never>(
	expected: NoInfer<State>
): Step<State, Input, Event, Rejection> => Step.State({ expected });

/** Requires the state to pass a check, shown in lines by its label. */
export const satisfies = <State = never, Input = never, Event = never, Rejection = never>(
	label: string,
	check: (current: NoInfer<State>) => boolean
): Step<State, Input, Event, Rejection> => Step.Satisfies({ label, check });

export class Decision<State, Input, Event, Rejection> extends Data.TaggedClass('Decision')<{
	readonly title: string;
	readonly decider: Decider<State, Input, Event, Rejection>;
	readonly steps: ReadonlyArray<Step<State, Input, Event, Rejection>>;
}> {
	[TypeId](): Told {
		return { lines: lines(this), run: run(this) };
	}
}

export const make = <State, Input, Event, Rejection>(
	title: string,
	decider: Decider<State, Input, Event, Rejection>,
	...body: ReadonlyArray<Step<State, Input, Event, Rejection>>
): Decision<State, Input, Event, Rejection> => new Decision({ title, decider, steps: body });

/** What a passing decision reached: its final state, also as a line. */
export interface Outcome<State> {
	readonly state: State;
	readonly final: string;
}

const liner = <State, Input, Event, Rejection>(
	decider: Decider<State, Input, Event, Rejection>
) => {
	const showState = describer(decider.State);
	const showInput = describer(decider.Input);
	const showEvent = describer(decider.Event);
	const showRejection = describer(decider.Rejection);
	return (step: Step<State, Input, Event, Rejection>) =>
		Step.$match(step, {
			Given: ({ state: start }) => `given ${showState(start)}`,
			When: ({ input }) => `when ${showInput(input)}`,
			Accepted: ({ events }) =>
				`accepted ${events.length === 0 ? 'none' : events.map(showEvent).join(', ')}`,
			Rejected: ({ rejection }) => `rejected ${showRejection(rejection)}`,
			State: ({ expected }) => `state ${showState(expected)}`,
			Satisfies: ({ label }) => `satisfies ${label}`
		});
};

/** Renders a decision as plain lines, from its value alone. */
export const lines = <State, Input, Event, Rejection>(
	decision: Decision<State, Input, Event, Rejection>
): ReadonlyArray<string> => decision.steps.map(liner(decision.decider));

type Decided<Event, Rejection> = Result.Result<ReadonlyArray<Event>, Rejection>;

/** Where a decision's state lives: in memory with the strict checks, or in a Store. */
interface Backend<State, Input, Event, Rejection, E> {
	readonly seed: (state: State) => Effect.Effect<void, Problem | E>;
	readonly decide: (input: Input) => Effect.Effect<Decided<Event, Rejection>, Problem | E>;
	readonly current: Effect.Effect<State, E>;
}

const isProblem = (error: unknown): error is Problem => error instanceof Problem;

const tell = Effect.fnUntraced(function* <State, Input, Event, Rejection, E>(
	decision: Decision<State, Input, Event, Rejection>,
	backend: Backend<State, Input, Event, Rejection, E>
): Effect.fn.Return<Outcome<State>, StoryFailure | E> {
	const { decider, title } = decision;
	const line = liner(decider);
	const showState = describer(decider.State);
	const showEvent = describer(decider.Event);
	const showRejection = describer(decider.Rejection);
	const stateKey = stringifier(decider.State);
	const eventKey = stringifier(decider.Event);
	const rejectionKey = stringifier(decider.Rejection);
	const validState = conforms(decider.State, 'the state');
	const validInput = conforms(decider.Input, 'the input');
	const validEvent = conforms(decider.Event, 'the event');
	const validRejection = conforms(decider.Rejection, 'the rejection');
	const eventLines = (events: ReadonlyArray<Event>) => events.map(showEvent).join('\n');
	const unanswered = 'a when needs accepted(...) or rejected(...) right after it';

	const fail = (entry: { readonly no: number; readonly line: string }) => (problem: Problem) =>
		new StoryFailure({
			title,
			step: entry.no,
			line: entry.line,
			message: problem.message,
			expected: problem.expected,
			actual: problem.actual
		});

	const answer = (
		decided: Option.Option<Decided<Event, Rejection>>,
		name: string,
		compare: (result: Decided<Event, Rejection>) => Effect.Effect<void, Problem>
	) =>
		Option.match(decided, {
			onNone: () => Effect.fail(new Problem({ message: `${name}(...) comes right after a when` })),
			onSome: (result) => Effect.as(compare(result), Option.none())
		});

	const current = (check: (state: State) => Effect.Effect<void, Problem>) =>
		Effect.flatMap(backend.current, check);

	const step = (
		index: number,
		decided: Option.Option<Decided<Event, Rejection>>,
		next: Step<State, Input, Event, Rejection>
	): Effect.Effect<Option.Option<Decided<Event, Rejection>>, Problem | E> =>
		Option.isSome(decided) && !Step.$is('Accepted')(next) && !Step.$is('Rejected')(next)
			? Effect.fail(new Problem({ message: unanswered }))
			: Step.$match(next, {
					Given: ({ state: start }) =>
						index === 0
							? Effect.as(Effect.andThen(validState(start), backend.seed(start)), Option.none())
							: Effect.fail(new Problem({ message: 'given(state) comes once, first' })),
					When: ({ input }) =>
						Effect.asSome(Effect.andThen(validInput(input), backend.decide(input))),
					Accepted: ({ events }) =>
						answer(decided, 'accepted', (result) =>
							Effect.andThen(
								Effect.forEach(events, validEvent),
								Result.match(result, {
									onFailure: (rejection) =>
										Effect.fail(
											new Problem({
												message: 'the input was rejected',
												expected: eventLines(events),
												actual: showRejection(rejection)
											})
										),
									onSuccess: (actual) =>
										JSON.stringify(actual.map(eventKey)) === JSON.stringify(events.map(eventKey))
											? Effect.void
											: Effect.fail(
													new Problem({
														message: 'the events differ',
														expected: eventLines(events),
														actual: eventLines(actual)
													})
												)
								})
							)
						),
					Rejected: ({ rejection }) =>
						answer(decided, 'rejected', (result) =>
							Effect.andThen(
								validRejection(rejection),
								Result.match(result, {
									onFailure: (actual) =>
										rejectionKey(actual) === rejectionKey(rejection)
											? Effect.void
											: Effect.fail(
													new Problem({
														message: 'the rejection differs',
														expected: showRejection(rejection),
														actual: showRejection(actual)
													})
												),
									onSuccess: (events) =>
										Effect.fail(
											new Problem({
												message: 'the input was accepted',
												expected: showRejection(rejection),
												actual: eventLines(events)
											})
										)
								})
							)
						),
					State: ({ expected }) =>
						Effect.as(
							Effect.andThen(
								validState(expected),
								current((actual) =>
									stateKey(actual) === stateKey(expected)
										? Effect.void
										: Effect.fail(
												new Problem({
													message: 'the state differs',
													expected: showState(expected),
													actual: showState(actual)
												})
											)
								)
							),
							decided
						),
					Satisfies: ({ label, check }) =>
						Effect.as(
							current((actual) =>
								Effect.flatMap(
									attempt(label, () => check(actual)),
									(ok) =>
										ok
											? Effect.void
											: Effect.fail(
													new Problem({
														message: `the state does not satisfy ${label}`,
														actual: showState(actual)
													})
												)
								)
							),
							decided
						)
				});

	const [first] = decision.steps;
	if (!Step.$is('Given')(first)) {
		return yield* fail({ no: 1, line: first === undefined ? '' : line(first) })(
			new Problem({ message: 'a decision starts with given(state)' })
		);
	}
	let decided = Option.none<Decided<Event, Rejection>>();
	for (const [index, next] of decision.steps.entries()) {
		decided = yield* step(index, decided, next).pipe(
			Effect.catchIf(isProblem, (problem) =>
				Effect.fail(fail({ no: index + 1, line: line(next) })(problem))
			)
		);
	}
	if (Option.isSome(decided)) {
		return yield* fail({ no: decision.steps.length + 1, line: 'end' })(
			new Problem({ message: unanswered })
		);
	}
	const reached = yield* backend.current;
	return { state: reached, final: showState(reached) };
});

/** Keeps the state in memory and checks every strict rule on `decide` and `evolve`. */
const memory = Effect.fnUntraced(function* <State, Input, Event, Rejection>(
	decider: Decider<State, Input, Event, Rejection>
) {
	const stored = yield* Ref.make(decider.initial);
	const showState = describer(decider.State);
	const stateKey = stringifier(decider.State);
	const inputKey = stringifier(decider.Input);
	const eventKey = stringifier(decider.Event);
	const rejectionKey = stringifier(decider.Rejection);
	const validState = conforms(decider.State, 'the state');
	const validEvent = conforms(decider.Event, 'the event');
	const validRejection = conforms(decider.Rejection, 'the rejection');
	const durable = roundTrips(decider.State, 'the state');
	const invariants = holds(decider.invariants, showState);
	const settle = (reached: State) =>
		Effect.andThen(Effect.all([durable(reached), invariants(reached)]), Ref.set(stored, reached));
	const output = (decided: Decided<Event, Rejection>) =>
		Result.match(decided, {
			onSuccess: (events) =>
				Effect.as(
					Effect.forEach(events, validEvent),
					`accepted ${JSON.stringify(events.map(eventKey))}`
				),
			onFailure: (rejection) =>
				Effect.as(validRejection(rejection), `rejected ${rejectionKey(rejection)}`)
		});
	const backend: Backend<State, Input, Event, Rejection, never> = {
		seed: settle,
		decide: (input) =>
			Effect.gen(function* () {
				const current = yield* Ref.get(stored);
				const decided = yield* pure(
					'decide',
					() => stateKey(current) + inputKey(input),
					() => decider.decide(current, input),
					output
				);
				if (Result.isSuccess(decided)) {
					yield* settle(
						yield* Effect.reduce(
							decided.success,
							() => current,
							(from, event) =>
								pure(
									'evolve',
									() => stateKey(from) + eventKey(event),
									() => decider.evolve(from, event),
									(evolved) => Effect.as(validState(evolved), stateKey(evolved))
								)
						)
					);
				}
				return decided;
			}),
		current: Ref.get(stored)
	};
	return backend;
});

/** Runs a decision in memory: every step and every strict rule. */
export const run = <State, Input, Event, Rejection>(
	decision: Decision<State, Input, Event, Rejection>
): Effect.Effect<Outcome<State>, StoryFailure> =>
	Effect.flatMap(memory(decision.decider), (backend) => tell(decision, backend));

/**
 * Runs a decision through `handle`'s transaction on a real Store, under `key`: `given` saves its
 * state, each `when` decides and saves, and `state` loads. Store errors fail as they are.
 */
export const against = <State, Input, Event, Rejection, Id, Key, E>(
	decision: Decision<State, Input, Event, Rejection>,
	Store: Context.Key<Id, Store<Key, State, Event, E>>,
	key: Key
): Effect.Effect<Outcome<State>, StoryFailure | E, Id> =>
	Effect.flatMap(Store, (store) =>
		tell(decision, {
			seed: (start) => store.transaction(store.save(key, start, [])),
			decide: (input) => decideIn(decision.decider, store)(key, input),
			current: loadOrInitial(decision.decider, store, key)
		})
	);
