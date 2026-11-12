import { describe } from '@effect/vitest';
import { Story, Vitest } from 'effect-storytime/testing';
import { chat, Command, Message, ready } from '../../../examples/chat.ts';

const { Asked, Stopped } = Message.cases;
const asked = Asked.make({ turn: 't1', text: 'Why?' });

describe('chat', () => {
	Vitest.stories(
		Story.make(
			'a question is stopped',
			chat,
			Story.given(ready(1)),
			Story.send(asked),
			Story.commands(Command.cases.Ask.make({ turn: 't1', text: 'Why?' })),
			Story.send(Stopped.make({}))
		),
		Story.make(
			'a question is forgotten',
			chat,
			Story.given(ready(1)),
			Story.send(asked),
			Story.commands()
		)
	);
});
