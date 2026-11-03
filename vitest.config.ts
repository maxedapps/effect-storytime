import { defineConfig } from 'vitest/config';

export default defineConfig({
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
