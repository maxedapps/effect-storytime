import { defineConfig } from 'oxfmt';

export default defineConfig({
	printWidth: 100,
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	sortPackageJson: true,
	ignorePatterns: [
		'**/*.md',
		'coverage/**',
		'dist/**',
		'reports/**',
		// The reporter's exact output, which the reporter test compares byte for byte.
		'test/fixtures/report.json',
		'tools/oxlint/anti-slop/**'
	]
});
