/**
 * A decision tells how a Decider rules, as steps: start from a state, send commands and name the
 * events or the rejection each one gives. `run` checks it in memory with the strict rules,
 * `against` through `handle`'s transaction on a real Store.
 */
import { Array as Arr, Data, Effect, Option, Ref, Result } from 'effect';
import type { Context } from 'effect';
import type { Decider, Store } from '../Decider.ts';
import { describer } from '../internal/canonical.ts';
import { attempt, Problem } from './internal/check.ts';
import { caser, checks, strict } from './internal/decider.ts';
import type { Decided } from './internal/decider.ts';
import { decideIn, loadOrInitial } from '../internal/transition.ts';
import type { Transition } from '../internal/transition.ts';
import { located, made, TypeId } from './internal/tale.ts';
import type { Told } from './internal/tale.ts';
import { StoryFailure } from './Story.ts';

export type Step<State, Command, Event, Rejection> = Data.TaggedEnum<{
	Given: { readonly state: State };
	When: { readonly command: Command };
	Accepted: { readonly events: ReadonlyArray<Event> };
	Rejected: { readonly rejection: Rejection };
	State: { readonly expected: State };
	Satisfies: { readonly label: string; readonly check: (state: State) => boolean };
}>;

interface StepDefinition extends Data.TaggedEnum.WithGenerics<4> {
	readonly taggedEnum: Step<this['A'], this['B'], this['C'], this['D']>;
}

const Step = Data.taggedEnum<StepDefinition>();

/** The steps of decisions about one Decider, typed by it, so steps built anywhere need no type parameters. */
export interface Builders<State, Command, Event, Rejection> {
	/** Starts the decision from a state. It comes first and only once. */
	readonly given: (state: State) => Step<State, Command, Event, Rejection>;
	/** Decides a command. The next step names its events or its rejection. */
	readonly when: (command: Command) => Step<State, Command, Event, Rejection>;
	/** Requires the command to give exactly these events, in this order; `accepted()` means none. */
	readonly accepted: (...events: ReadonlyArray<Event>) => Step<State, Command, Event, Rejection>;
	/** Requires the command to be rejected with `rejection`. */
	readonly rejected: (rejection: Rejection) => Step<State, Command, Event, Rejection>;
	/** Requires the state to equal `expected`. */
	readonly state: (expected: State) => Step<State, Command, Event, Rejection>;
	/** Requires the state to pass a check, shown in lines by its label. */
	readonly satisfies: (
		label: string,
		check: (state: State) => boolean
	) => Step<State, Command, Event, Rejection>;
}

/** The step builders for decisions about `decider`; only its types matter. */
export const of = <State, Command, Event, Rejection>(
	_decider: Decider<State, Command, Event, Rejection>
): Builders<State, Command, Event, Rejection> => ({
	given: (state) => Step.Given({ state }),
	when: (command) => Step.When({ command }),
	accepted: (...events) => Step.Accepted({ events }),
	rejected: (rejection) => Step.Rejected({ rejection }),
	state: (expected) => Step.State({ expected }),
	satisfies: (label, check) => Step.Satisfies({ label, check })
});

export class Decision<State, Command, Event, Rejection> extends Data.TaggedClass('Decision')<{
	readonly title: string;
	readonly decider: Decider<State, Command, Event, Rejection>;
	readonly steps: ReadonlyArray<Step<State, Command, Event, Rejection>>;
}> {
	[TypeId](): Told {
		return { subject: this.decider, lines: lines(this), run: run(this) };
	}
}

export const make = <State, Command, Event, Rejection>(
	title: string,
	decider: Decider<State, Command, Event, Rejection>,
	...body: ReadonlyArray<Step<State, Command, Event, Rejection>>
): Decision<State, Command, Event, Rejection> =>
	made(new Decision({ title, decider, steps: body }), make);

/** What a passing decision reached: its final state, also as a line, and the cases it touched. */
export interface Outcome<State> {
	readonly state: State;
	readonly final: string;
	readonly cases: ReadonlyArray<string>;
}

const liner = <State, Command, Event, Rejection>(
	decider: Decider<State, Command, Event, Rejection>
) => {
	const showState = describer(decider.State);
	const showCommand = describer(decider.Command);
	const showEvent = describer(decider.Event);
	const showRejection = describer(decider.Rejection);
	return (step: Step<State, Command, Event, Rejection>) =>
		Step.$match(step, {
			Given: ({ state: start }) => `given ${showState(start)}`,
			When: ({ command }) => `when ${showCommand(command)}`,
			Accepted: ({ events }) =>
				`accepted ${events.length === 0 ? 'none' : events.map(showEvent).join(', ')}`,
			Rejected: ({ rejection }) => `rejected ${showRejection(rejection)}`,
			State: ({ expected }) => `state ${showState(expected)}`,
			Satisfies: ({ label }) => `satisfies ${label}`
		});
};

/** Renders a decision as plain lines, from its value alone. */
export const lines = <State, Command, Event, Rejection>(
	decision: Decision<State, Command, Event, Rejection>
): ReadonlyArray<string> => decision.steps.map(liner(decision.decider));

/** Where a decision's state lives, in memory or in a Store, checked by the strict rules either way. */
interface Backend<State, Command, Event, Rejection, E> {
	/** Puts the given state in place, where the backend owns it; `current` must equal it after. */
	readonly start: (state: State) => Effect.Effect<void, Problem | E>;
	readonly decide: (
		command: Command
	) => Effect.Effect<Transition<State, Event, Rejection>, Problem | E>;
	readonly current: Effect.Effect<State, Problem | E>;
}

const isProblem = (error: unknown): error is Problem => error instanceof Problem;

const tell = Effect.fnUntraced(function* <State, Command, Event, Rejection, E>(
	decision: Decision<State, Command, Event, Rejection>,
	backend: Backend<State, Command, Event, Rejection, E>
): Effect.fn.Return<Outcome<State>, StoryFailure | E> {
	const { decider, title } = decision;
	const line = liner(decider);
	const the = checks(decider);
	const touch = caser(decider);
	const touched = yield* Ref.make<ReadonlyArray<string>>([]);
	const note = (cases: ReadonlyArray<string>) => Ref.update(touched, (all) => [...all, ...cases]);
	const eventsKey = (events: ReadonlyArray<Event>) =>
		Effect.map(Effect.forEach(events, the.event.key), JSON.stringify);
	const eventLines = (events: ReadonlyArray<Event>) => events.map(the.event.show).join('\n');
	const unanswered = 'a when needs accepted(...) or rejected(...) right after it';

	const fail = (entry: { readonly no: number; readonly line: string }) => (problem: Problem) =>
		located(
			decision,
			new StoryFailure({
				title,
				step: entry.no,
				line: entry.line,
				problem: problem.message,
				expected: problem.expected,
				actual: problem.actual
			})
		);

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

	const same = (expected: State, message: string) =>
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
										message,
										expected: the.state.show(expected),
										actual: the.state.show(actual)
									})
								)
				)
			)
		);

	const step = (
		index: number,
		decided: Option.Option<Decided<Event, Rejection>>,
		next: Step<State, Command, Event, Rejection>
	): Effect.Effect<Option.Option<Decided<Event, Rejection>>, Problem | E> =>
		Option.isSome(decided) && !Step.$is('Accepted')(next) && !Step.$is('Rejected')(next)
			? Effect.fail(new Problem({ message: unanswered }))
			: Step.$match(next, {
					Given: ({ state: start }) =>
						index === 0
							? Effect.as(
									backend
										.start(start)
										.pipe(
											Effect.andThen(same(start, 'the stored state differs from given')),
											Effect.andThen(note(touch.state(start)))
										),
									Option.none()
								)
							: Effect.fail(new Problem({ message: 'given(state) comes once, first' })),
					When: ({ command }) =>
						Effect.flatMap(backend.decide(command), (ruled) =>
							Effect.as(note(touch.ruled(command, ruled)), Option.some(ruled.decided))
						),
					Accepted: ({ events }) =>
						answer(decided, 'accepted', (result) =>
							Effect.andThen(
								Effect.forEach(events, the.event.valid),
								Result.match(result, {
									onFailure: (rejection) =>
										Effect.fail(
											new Problem({
												message: 'the command was rejected',
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
												message: 'the command was accepted',
												expected: the.rejection.show(rejection),
												actual: eventLines(events)
											})
										)
								})
							)
						),
					State: ({ expected }) => Effect.as(same(expected, 'the state differs'), decided),
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
	return {
		state: reached,
		final: the.state.show(reached),
		cases: Arr.dedupe(yield* Ref.get(touched)).toSorted()
	};
});

/** Keeps the state in memory. */
const memory = Effect.fnUntraced(function* <State, Command, Event, Rejection>(
	decider: Decider<State, Command, Event, Rejection>
) {
	const rules = strict(decider);
	const stored = yield* Ref.make(decider.initial);
	const backend: Backend<State, Command, Event, Rejection, never> = {
		start: (first) => Effect.flatMap(rules.check(first), (copy) => Ref.set(stored, copy)),
		decide: (command) =>
			Effect.tap(
				Effect.flatMap(Ref.get(stored), (current) => rules.rule(current, command)),
				({ reached }) => Ref.set(stored, reached)
			),
		current: Ref.get(stored)
	};
	return backend;
});

/** Runs a decision in memory: every step and every strict rule. */
export const run = <State, Command, Event, Rejection>(
	decision: Decision<State, Command, Event, Rejection>
): Effect.Effect<Outcome<State>, StoryFailure> =>
	Effect.flatMap(memory(decision.decider), (backend) => tell(decision, backend));

/**
 * Runs a decision through `handle`'s transaction on a real Store, under `key`, with every strict
 * rule. The test arranges the Store beforehand: `given` loads the state under `key` (or `initial`)
 * and fails unless it equals the given state. Each `when` decides and saves, and `state` loads and
 * checks what the Store gives back. Store errors fail as they are.
 */
export const against = <State, Command, Event, Rejection, Id, Key, E>(
	decision: Decision<State, Command, Event, Rejection>,
	Store: Context.Key<Id, Store<Key, State, Event, E>>,
	key: Key
): Effect.Effect<Outcome<State>, StoryFailure | E, Id> =>
	Effect.flatMap(Store, (store) => {
		const rules = strict(decision.decider);
		const decide = decideIn(decision.decider, store, rules.rule);
		return tell(decision, {
			start: () => Effect.void,
			decide: (command) => decide(key, command),
			current: Effect.flatMap(loadOrInitial(decision.decider, store, key), rules.check)
		});
	});
