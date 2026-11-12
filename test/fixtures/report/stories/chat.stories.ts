import { describe } from '@effect/vitest';
import { Story } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import { chat, Command, Message, ready } from '../../../examples/chat.ts';

const { Asked, Stopped } = Message.cases;
const story = Story.of(chat);
const asked = Asked.make({ turn: 't1', text: 'Why?' });

describe('chat', () => {
	Vitest.stories(
		Story.make(
			'a question is stopped',
			chat,
			story.given(ready(1)),
			story.send(asked),
			story.commands(Command.cases.Ask.make({ turn: 't1', text: 'Why?' })),
			story.send(Stopped.make({}))
		),
		Story.make(
			'a question is forgotten',
			chat,
			story.given(ready(1)),
			story.send(asked),
			story.commands()
		)
	);
});
