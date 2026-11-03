import { defineConfig } from 'oxfmt';

export default defineConfig({
	printWidth: 100,
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	sortPackageJson: true,
	ignorePatterns: ['**/*.md', 'coverage/**', 'dist/**', 'reports/**', 'tools/oxlint/anti-slop/**']
});
