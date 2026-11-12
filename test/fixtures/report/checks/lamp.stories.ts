import { Arbitrary, Schema } from 'effect';
import { Exploration, Vitest } from '../../../../src/testing/index.ts';
import * as Lamp from '../../../examples/lamp.ts';

Vitest.stories(
	Exploration.make('the lamp counts switches', Lamp.lamp, {
		given: Arbitrary.Constant(Lamp.off),
		send: Arbitrary.map(Arbitrary.schema(Schema.Int), Lamp.switched)
	})
);
