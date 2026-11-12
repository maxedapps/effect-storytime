// A consumer's Vitest config with the story reporter. Only type-checked: the reporter's own test
// runs it on test/fixtures/report.
// #region config
import { Vitest } from 'effect-storytime/testing';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		reporters: ['default', new Vitest.Reporter({ outputFile: 'reports/stories.json' })]
	}
});
// #endregion config
