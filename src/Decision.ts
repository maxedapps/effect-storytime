/**
 * A decision tells how a Decider rules, as steps: start from a state, send inputs and name the
 * events or the rejection each one gives. `run` checks it in memory with the strict rules,
 * `against` through `handle`'s transaction on a real Store.
 */
import { Data, Effect, Option, Ref, Result } from 'effect';
import type { Context } from 'effect';
import type { Decider, Store } from './Decider.ts';
import { describer } from './internal/canonical.ts';
import { TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import { attempt, holds, Problem, pure, role } from './internal/check.ts';
import { decideIn, loadOrInitial } from './internal/store.ts';
import type { Ruling } from './internal/store.ts';
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

/** Where a decision's state lives, in memory or in a Store, checked by the strict rules either way. */
interface Backend<State, Input, Event, Rejection, E> {
	readonly seed: (state: State) => Effect.Effect<void, Problem | E>;
	readonly decide: (input: Input) => Effect.Effect<Decided<Event, Rejection>, Problem | E>;
	readonly current: Effect.Effect<State, Problem | E>;
}

const isProblem = (error: unknown): error is Problem => error instanceof Problem;

/** The checks on a Decider's Schemas. */
const checks = <State, Input, Event, Rejection>(
	decider: Decider<State, Input, Event, Rejection>
) => ({
	state: role(decider.State, 'the state'),
	input: role(decider.Input, 'the input'),
	event: role(decider.Event, 'the event'),
	rejection: role(decider.Rejection, 'the rejection')
});

const tell = Effect.fnUntraced(function* <State, Input, Event, Rejection, E>(
	decision: Decision<State, Input, Event, Rejection>,
	backend: Backend<State, Input, Event, Rejection, E>
): Effect.fn.Return<Outcome<State>, StoryFailure | E> {
	const { decider, title } = decision;
	const line = liner(decider);
	const the = checks(decider);
	const eventsKey = (events: ReadonlyArray<Event>) =>
		Effect.map(Effect.forEach(events, the.event.key), JSON.stringify);
	const eventLines = (events: ReadonlyArray<Event>) => events.map(the.event.show).join('\n');
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
							? Effect.as(backend.seed(start), Option.none())
							: Effect.fail(new Problem({ message: 'given(state) comes once, first' })),
					When: ({ input }) =>
						Effect.asSome(Effect.andThen(the.input.valid(input), backend.decide(input))),
					Accepted: ({ events }) =>
						answer(decided, 'accepted', (result) =>
							Effect.andThen(
								Effect.forEach(events, the.event.valid),
								Result.match(result, {
									onFailure: (rejection) =>
										Effect.fail(
											new Problem({
												message: 'the input was rejected',
												expected: eventLines(events),
												actual: the.rejection.show(rejection)
											})
										),
									onSuccess: (actual) =>
										Effect.flatMap(
											Effect.all([eventsKey(events), eventsKey(actual)]),
											([wanted, got]) =>
												wanted === got
													? Effect.void
													: Effect.fail(
															new Problem({
																message: 'the events differ',
																expected: eventLines(events),
																actual: eventLines(actual)
															})
														)
										)
								})
							)
						),
					Rejected: ({ rejection }) =>
						answer(decided, 'rejected', (result) =>
							Effect.andThen(
								the.rejection.valid(rejection),
								Result.match(result, {
									onFailure: (actual) =>
										Effect.flatMap(
											Effect.all([the.rejection.key(rejection), the.rejection.key(actual)]),
											([wanted, got]) =>
												wanted === got
													? Effect.void
													: Effect.fail(
															new Problem({
																message: 'the rejection differs',
																expected: the.rejection.show(rejection),
																actual: the.rejection.show(actual)
															})
														)
										),
									onSuccess: (events) =>
										Effect.fail(
											new Problem({
												message: 'the input was accepted',
												expected: the.rejection.show(rejection),
												actual: eventLines(events)
											})
										)
								})
							)
						),
					State: ({ expected }) =>
						Effect.as(
							Effect.andThen(
								the.state.valid(expected),
								current((actual) =>
									Effect.flatMap(
										Effect.all([the.state.key(expected), the.state.key(actual)]),
										([wanted, got]) =>
											wanted === got
												? Effect.void
												: Effect.fail(
														new Problem({
															message: 'the state differs',
															expected: the.state.show(expected),
															actual: the.state.show(actual)
														})
													)
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
														actual: the.state.show(actual)
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
	/** Fails a Problem as a StoryFailure at `entry`; other errors pass through. */
	const at =
		(entry: { readonly no: number; readonly line: string }) =>
		<A>(effect: Effect.Effect<A, Problem | E>) =>
			Effect.catchIf(effect, isProblem, (problem) => Effect.fail(fail(entry)(problem)));
	let decided = Option.none<Decided<Event, Rejection>>();
	for (const [index, next] of decision.steps.entries()) {
		decided = yield* step(index, decided, next).pipe(at({ no: index + 1, line: line(next) }));
	}
	const end = { no: decision.steps.length + 1, line: 'end' };
	if (Option.isSome(decided)) {
		return yield* fail(end)(new Problem({ message: unanswered }));
	}
	const reached = yield* backend.current.pipe(at(end));
	return { state: reached, final: the.state.show(reached) };
});

const joined = (parts: ReadonlyArray<Effect.Effect<string, Problem>>) =>
	Effect.map(Effect.all(parts), JSON.stringify);

/**
 * The strict rules on a Decider: `check` validates a state and gives its decoded copy, and `rule`
 * runs `decide` and `evolve` twice each on copies, validating what they give and continuing from
 * copies of it, so no callback holds a value the decision names.
 */
const strict = <State, Input, Event, Rejection>(
	decider: Decider<State, Input, Event, Rejection>
) => {
	const the = checks(decider);
	const invariants = holds(decider.invariants, the.state.show);
	const check = (current: State) =>
		Effect.gen(function* () {
			yield* the.state.valid(current);
			const copy = yield* the.state.copy(current);
			yield* invariants(copy);
			return copy;
		});

	const output = (decided: Decided<Event, Rejection>) =>
		Result.match(decided, {
			onSuccess: (events) =>
				Effect.andThen(
					Effect.forEach(events, the.event.valid),
					Effect.map(
						Effect.forEach(events, the.event.key),
						(keys) => `accepted ${JSON.stringify(keys)}`
					)
				),
			onFailure: (rejection) =>
				Effect.andThen(
					the.rejection.valid(rejection),
					Effect.map(the.rejection.key(rejection), (key) => `rejected ${key}`)
				)
		});

	const rule = (
		current: State,
		input: Input
	): Effect.Effect<Ruling<State, Event, Rejection>, Problem> =>
		Effect.gen(function* () {
			const copy = yield* the.input.copy(input);
			const decided = yield* pure(
				'decide',
				joined([the.state.key(current), the.input.key(copy)]),
				() => decider.decide(current, copy),
				output
			);
			if (Result.isFailure(decided)) return { decided, reached: current };
			const events = yield* Effect.forEach(decided.success, the.event.copy);
			const reached = yield* Effect.reduce(
				events,
				() => current,
				(from, event) =>
					pure(
						'evolve',
						joined([the.state.key(from), the.event.key(event)]),
						() => decider.evolve(from, event),
						(next) => Effect.andThen(the.state.valid(next), the.state.key(next))
					).pipe(Effect.flatMap(the.state.copy))
			);
			yield* invariants(reached);
			return { decided: Result.succeed(events), reached };
		});

	return { check, rule };
};

/** Keeps the state in memory. */
const memory = Effect.fnUntraced(function* <State, Input, Event, Rejection>(
	decider: Decider<State, Input, Event, Rejection>
) {
	const rules = strict(decider);
	const stored = yield* Ref.make(decider.initial);
	const backend: Backend<State, Input, Event, Rejection, never> = {
		seed: (start) => Effect.flatMap(rules.check(start), (copy) => Ref.set(stored, copy)),
		decide: (input) =>
			Effect.gen(function* () {
				const { decided, reached } = yield* rules.rule(yield* Ref.get(stored), input);
				yield* Ref.set(stored, reached);
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
 * Runs a decision through `handle`'s transaction on a real Store, under `key`, with every strict
 * rule: `given` saves its state, each `when` decides and saves, and `state` loads and checks what
 * the Store gives back. Store errors fail as they are.
 */
export const against = <State, Input, Event, Rejection, Id, Key, E>(
	decision: Decision<State, Input, Event, Rejection>,
	Store: Context.Key<Id, Store<Key, State, Event, E>>,
	key: Key
): Effect.Effect<Outcome<State>, StoryFailure | E, Id> =>
	Effect.flatMap(Store, (store) => {
		const rules = strict(decision.decider);
		const decide = decideIn(decision.decider, store, rules.rule);
		return tell(decision, {
			seed: (start) =>
				Effect.flatMap(rules.check(start), (copy) => store.transaction(store.save(key, copy, []))),
			decide: (input) => decide(key, input),
			current: Effect.flatMap(loadOrInitial(decision.decider, store, key), rules.check)
		});
	});
