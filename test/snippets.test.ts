// The docs show code only from checked files: a TypeScript block follows a
// `<!-- snippet: <file>#<region> -->` marker and equals that region of the file, which tsc, oxlint
// and these tests check. `pnpm vitest run test/snippets.test.ts -u` rewrites the blocks from the code.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@effect/vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');

const pages = ['README.md', ...readdirSync(`${root}docs`).map((name) => `docs/${name}`)];

const marker = /^<!-- snippet: \S+#\S+ -->$/;
const snippet = /^(<!-- snippet: (\S+)#(\S+) -->\n```ts\n)[\s\S]*?\n```$/gm;
const regionLine = /^\s*\/\/ #(?:end)?region \S+$/;

/** The lines between `// #region <name>` and `// #endregion <name>`, without other markers, dedented. */
const region = (file: string, name: string) => {
	const lines = read(file).split('\n');
	const start = lines.findIndex((line) => line.trim() === `// #region ${name}`);
	const end = lines.findIndex((line) => line.trim() === `// #endregion ${name}`);
	if (start === -1 || end < start) throw new Error(`${file} has no region ${name}`);
	const body = lines.slice(start + 1, end).filter((line) => !regionLine.test(line));
	const indent = Math.min(
		...body.filter((line) => line.trim() !== '').map((line) => /^\t*/.exec(line)?.[0].length ?? 0)
	);
	return body.map((line) => line.slice(indent)).join('\n');
};

describe('docs snippets', () => {
	it.each(pages)('%s shows its code as the checked files have it', async (page) => {
		const text = read(page);
		const synced = text.replaceAll(
			snippet,
			(_, head: string, file: string, name: string) => `${head}${region(file, name)}\n\`\`\``
		);
		await expect(synced).toMatchFileSnapshot(`${root}${page}`);
	});

	it.each(pages)('%s marks every TypeScript block with its source', (page) => {
		const lines = read(page).split('\n');
		const unmarked = lines.flatMap((line, index) =>
			line === '```ts' && !marker.test(lines[index - 1] ?? '') ? [index + 1] : []
		);
		expect(unmarked).toEqual([]);
	});
});
