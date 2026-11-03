import { Arbitrary, Schema } from 'effect';
import { Exploration } from '../../../../src/index.ts';
import { stories } from '../../../../src/vitest.ts';
import * as Lamp from '../../../examples/lamp.ts';

stories(
	Exploration.make('the lamp counts switches', Lamp.lamp, {
		given: Arbitrary.Constant(Lamp.off),
		send: Arbitrary.map(Arbitrary.schema(Schema.Int), Lamp.switched)
	})
);
