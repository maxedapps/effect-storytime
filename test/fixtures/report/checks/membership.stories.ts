import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { Decision } from 'effect-storytime/testing';
import { Vitest } from 'effect-storytime/vitest';
import { membership, none, NotActive, Revoke } from '../../../examples/membership.ts';

const decision = Decision.of(membership);

const revokes = Decision.make(
	'only an active membership is revoked',
	membership,
	decision.given(none),
	decision.when(Revoke.make({})),
	decision.rejected(NotActive.make({}))
);

Vitest.stories(revokes);

it('tells no tale', () => {
	expect(Decision.lines(revokes)).toHaveLength(3);
});

const grants = Decision.make('a membership starts inactive', membership, decision.given(none));

// Told in the order the run's environment names, as concurrent tells finish in any order.
it.effect('tells tales in any order', (ctx) => {
	const tales = [
		Vitest.tell(ctx, revokes),
		Vitest.tell(ctx, revokes, Effect.fail('the store is down')),
		Vitest.tell(ctx, grants)
	];
	return Effect.forEach(
		process.env['STORYTIME_REVERSED'] === '1' ? tales.toReversed() : tales,
		Effect.exit,
		{
			discard: true
		}
	);
});
