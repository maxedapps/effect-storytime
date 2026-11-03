import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{ test: { name: 'stories', include: ['stories/*.stories.ts'] } },
			{ test: { name: 'checks', include: ['checks/*.stories.ts'] } }
		]
	}
});
