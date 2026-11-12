import { Arbitrary, Schema } from 'effect';
import { Exploration, Story } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import * as Lamp from '../../../examples/lamp.ts';

const lamp = Story.of(Lamp.lamp);

Vitest.stories(
	Exploration.make('the lamp counts switches', Lamp.lamp, {
		given: Arbitrary.Constant(Lamp.off),
		send: Arbitrary.map(Arbitrary.schema(Schema.Int), Lamp.switched)
	}),
	Story.make(
		'two switches leave the lamp off, in either order',
		Lamp.lamp,
		lamp.given(Lamp.off),
		lamp.anyOrder(lamp.send(Lamp.switched(1)), lamp.send(Lamp.switched(2))),
		lamp.satisfies('off', (current) => !current.on)
	)
);
