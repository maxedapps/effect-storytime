// The enrolment check as docs/loop.md shows it: its tales, and `Loop.run` driving it to the end.
import { describe, expect, it } from '@effect/vitest';
import { Arbitrary, Effect, Layer, Option, Schema } from 'effect';
import { Loop } from 'effect-storytime';
import { Exploration, Story } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import {
	Command,
	Enrolment,
	enrolment,
	idle,
	Message,
	Provider,
	ProviderFailed
} from '../examples/enrolment.ts';

const { Check, Found, Read } = Message.cases;
const { FindUser, ReadEnrolment } = Command.cases;
const { Decided } = Enrolment.cases;
const story = Story.of(enrolment);

const find = FindUser.make({ email: 'ada@example.com' });
const read = ReadEnrolment.make({ id: 7 });

const enrols = Story.make(
	'a learner without the course is enrolled, across a restart',
	enrolment,
	story.given(idle),
	story.send(Check.make({ email: 'ada@example.com' })),
	story.commands(find),
	story.resolve(find, Found.make({ id: 7 })),
	story.commands(read),
	story.restart(),
	story.commands(read),
	story.resolve(read, Read.make({ enrolled: false })),
	story.model(Decided.make({ step: 'Enrol', id: 7 })),
	story.commands()
);

const creates = Story.make(
	'a learner without an account gets one',
	enrolment,
	story.given(idle),
	story.send(Check.make({ email: 'ada@example.com' })),
	story.commands(find),
	story.resolve(find, Found.make({ id: null })),
	story.model(Decided.make({ step: 'Create', id: null })),
	story.commands()
);

const same = Schema.toEquivalence(Enrolment);

const answers = Exploration.make('any answers end in one valid decision', enrolment, {
	given: Arbitrary.map(Arbitrary.schema(Schema.Literals([0, 1])), () => idle),
	send: Arbitrary.map(Arbitrary.schema(Schema.Literals(['ada', 'bo'])), (name) =>
		Check.make({ email: `${name}@example.com` })
	),
	replies: Command.match({
		FindUser: () => [Found.make({ id: 7 }), Found.make({ id: null })],
		ReadEnrolment: () => [Read.make({ enrolled: true }), Read.make({ enrolled: false })]
	}),
	properties: {
		decidesOnce: ({ before, after }) => !Enrolment.guards.Decided(before) || same(before, after)
	}
});

describe('enrolment', () => {
	Vitest.stories(enrols, creates, answers);
	Vitest.covers(enrolment, [enrols, creates, answers]);
});

/** A provider that knows ada as 7, enrolled in nothing, and is rate limited for anyone else. */
const provider = Layer.succeed(Provider, {
	findUser: (email) =>
		email === 'ada@example.com'
			? Effect.succeedSome(7)
			: Effect.fail(new ProviderFailed({ reason: 'rate limited' })),
	enrolled: () => Effect.succeed(false)
});

describe('an enrolment run', () => {
	it.effect('decides, or fails with the provider', () =>
		Effect.gen(function* () {
			// #region run
			const check = Effect.fn('check')(function* (learner: string) {
				const api = yield* Provider;
				// Starts a Loop in its own scope, dispatches `messages`, runs every command through the
				// handler and feeds its answer back until nothing runs, then gives the model.
				return yield* Loop.run(enrolment, {
					init: { model: idle },
					handler: Command.match({
						FindUser: ({ email }) =>
							Effect.map(api.findUser(email), (id) => Found.make({ id: Option.getOrNull(id) })),
						ReadEnrolment: ({ id }) =>
							Effect.map(api.enrolled(id), (enrolled) => Read.make({ enrolled }))
					}),
					messages: [Check.make({ email: learner })]
				});
			});

			expect(yield* check('ada@example.com')).toEqual(Decided.make({ step: 'Enrol', id: 7 }));
			// A failure the Program doesn't decide on fails the run with its typed error.
			expect(yield* Effect.flip(check('bo@example.com'))).toEqual(
				new ProviderFailed({ reason: 'rate limited' })
			);
			// #endregion run
		}).pipe(Effect.provide(provider))
	);
});
