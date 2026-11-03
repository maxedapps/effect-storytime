// Tags the version in package.json for consumers to pin: a commit on top of HEAD that adds the
// built `dist/` and drops the `prepare` script, so installing the tag runs no build. Run it from a
// clean, landed main: `pnpm release`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Record, Schema } from 'effect';

const Manifest = Schema.StructWithRest(
	Schema.Struct({ version: Schema.String, scripts: Schema.Record(Schema.String, Schema.String) }),
	[Schema.Record(Schema.String, Schema.Json)]
);

const git = (
	args: ReadonlyArray<string>,
	options: { env?: NodeJS.ProcessEnv; input?: string } = {}
) =>
	execFileSync('git', args, {
		encoding: 'utf8',
		env: { ...process.env, ...options.env },
		input: options.input
	}).trim();

if (git(['status', '--porcelain']) !== '') throw new Error('Commit or stash every change first.');

const manifest = Schema.decodeSync(Schema.fromJsonString(Manifest))(
	readFileSync('package.json', 'utf8')
);
const tag = `v${manifest.version}`;
execFileSync('pnpm', ['build'], { stdio: 'inherit' });

const scratch = mkdtempSync(join(tmpdir(), 'storytime-release-'));
try {
	const env = { GIT_INDEX_FILE: join(scratch, 'index') };
	git(['read-tree', 'HEAD'], { env });
	git(['add', '--force', 'dist'], { env });
	const released = { ...manifest, scripts: Record.remove(manifest.scripts, 'prepare') };
	const blob = git(['hash-object', '-w', '--stdin'], {
		input: `${JSON.stringify(released, null, '\t')}\n`
	});
	git(['update-index', '--cacheinfo', `100644,${blob},package.json`], { env });
	const tree = git(['write-tree'], { env });
	const commit = git(['commit-tree', tree, '-p', 'HEAD', '-m', `Release ${tag}`]);
	git(['tag', '--annotate', tag, commit, '--message', `effect-storytime ${tag}`]);
	git(['push', 'origin', tag]);
	console.log(`Released ${tag} at ${commit}.`);
} finally {
	rmSync(scratch, { recursive: true });
}
