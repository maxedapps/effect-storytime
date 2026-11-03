import { expect, it } from '@effect/vitest';
import { placeholder } from '../src/index.ts';

it('loads', () => {
	expect(placeholder(1)).toBe(2);
});
