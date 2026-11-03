import { expect, it } from '@effect/vitest';
import { Decision } from '../../../../src/index.ts';
import { stories } from '../../../../src/vitest.ts';
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
