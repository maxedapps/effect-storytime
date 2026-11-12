import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		projects: [
			{ test: { name: 'stories', include: ['stories/*.stories.ts'] } },
			{ test: { name: 'checks', include: ['checks/*.stories.ts'] } }
		]
	}
});
