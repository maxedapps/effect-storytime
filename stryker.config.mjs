/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	testRunner: 'vitest',
	plugins: ['@stryker-mutator/vitest-runner'],
	mutate: ['src/**/*.ts'],
	coverageAnalysis: 'perTest',
	reporters: ['clear-text', 'progress', 'json'],
	jsonReporter: { fileName: 'reports/mutation.json' },
	thresholds: { high: 100, low: 100, break: 100 },
	// Stryker rewrites the tsconfig's extends and references through TypeScript's JS API, which
	// TypeScript 7 no longer ships. Ours has neither, so it names no tsconfig to rewrite.
	tsconfigFile: 'none'
};
