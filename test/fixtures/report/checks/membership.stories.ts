import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { Decision } from '../../../../src/index.ts';
import { stories, tell } from '../../../../src/vitest.ts';
import { membership, none, NotActive, Revoke } from '../../../examples/membership.ts';

const revokes = Decision.make(
	'only an active membership is revoked',
	membership,
	Decision.given(none),
	Decision.when(Revoke.make({})),
	Decision.rejected(NotActive.make({}))
);

stories(revokes);

it('tells no tale', () => {
	expect(Decision.lines(revokes)).toHaveLength(3);
});

const grants = Decision.make('a membership starts inactive', membership, Decision.given(none));

// Told in the order the run's environment names, as concurrent tells finish in any order.
it.effect('tells tales in any order', (ctx) => {
	const tales = [
		tell(ctx, revokes),
		tell(ctx, revokes, Effect.fail('the store is down')),
		tell(ctx, grants)
	];
	return Effect.forEach(
		process.env['STORYTIME_REVERSED'] === '1' ? tales.toReversed() : tales,
		Effect.exit,
		{
			discard: true
		}
	);
});
