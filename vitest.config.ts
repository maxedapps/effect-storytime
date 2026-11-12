import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Tests import `effect-storytime` as consumers do; tsconfig's paths point it at `src`.
	resolve: { tsconfigPaths: true },
	test: {
		include: ['test/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**'],
			reporter: ['text-summary', 'json-summary'],
			thresholds: { 100: true }
		}
	}
});
