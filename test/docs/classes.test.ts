// Schema classes as a Program's cases, as docs/domain-modelling.md shows them.
import { describe } from '@effect/vitest';
import { Schema } from 'effect';
import { Program } from 'effect-storytime';
import { Story } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';

// #region classes
class Enrol extends Schema.TaggedClass<Enrol>()('Enrol', { learner: Schema.String }) {}
class Leave extends Schema.TaggedClass<Leave>()('Leave', { learner: Schema.String }) {}
class Welcome extends Schema.TaggedClass<Welcome>()('Welcome', { learner: Schema.String }) {}

// A union of classes lists its cases, so a Program takes it as it takes a Schema.TaggedUnion.
const Message = Schema.Union([Enrol, Leave]).pipe(Schema.toTaggedUnion('_tag'));
const Command = Schema.Union([Welcome]).pipe(Schema.toTaggedUnion('_tag'));

const roster = Program.make({
	Model: Schema.Struct({ learners: Schema.Array(Schema.String) }),
	Message,
	Command,
	update: (model, message) =>
		Message.match(message, {
			Enrol: ({ learner }) => ({
				model: { learners: [...model.learners, learner] },
				commands: [new Welcome({ learner })]
			}),
			Leave: ({ learner }) => ({
				model: { learners: model.learners.filter((name) => name !== learner) }
			})
		})
});

const story = Story.of(roster);
const enrols = Story.make(
	'a learner enrols and leaves',
	roster,
	story.given({ learners: [] }),
	story.send(new Enrol({ learner: 'ada' })),
	story.resolve(new Welcome({ learner: 'ada' })),
	story.send(new Leave({ learner: 'ada' })),
	story.model({ learners: [] })
);
// #endregion classes

describe('classes', () => {
	Vitest.stories(enrols);
	Vitest.covers(roster, [enrols]);
});
