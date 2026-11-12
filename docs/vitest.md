# Vitest

`import { Vitest } from 'effect-storytime/testing'`

The Vitest adapter registers tales as `@effect/vitest` tests and records each told tale in its test's meta. Its `Reporter` collects those records into one JSON file, the story record ([story-record.md](story-record.md)). It needs `vitest` 5.1 and `@effect/vitest` 4.1.2 as dev dependencies.

## Registering tales

Call these inside a `describe`, at collection time:

<!-- snippet: test/docs/chat.test.ts#vitest -->
```ts
describe('chat', () => {
	// One test per tale, named by its title.
	Vitest.stories(answers, stops, resumes, limited, signedOut, talks);
	// One test, 'its tales touch every case': together they reach every Model, Message and Command case.
	Vitest.covers(chat, [answers, stops, resumes, limited, signedOut, talks]);
});
```

| Export | Meaning |
| --- | --- |
| `stories(...tales)` | Registers one `it.effect` test per tale, named by its title. A failing tale fails its test with the `StoryFailure`. |
| `covers(subject, tales)` | Registers one test, named `its tales touch every case`, that runs `Tale.covers` ([tales-and-covers.md](tales-and-covers.md)). |
| `tell(ctx, tale, run?)` | Runs a tale inside your own `it.effect`, records it in the test's meta and fails the test when it fails. Pass `run` when the tale needs services. |

`covers` always uses the same test name, so give each subject its own `describe` when one file covers several.

## Tales that need services

`Decision.against` needs the Store service, so it runs inside `layer(...)` from `@effect/vitest`, and `Vitest.tell` records it under the decision:

<!-- snippet: test/docs/membership.test.ts#vitest -->
```ts
describe('membership', () => {
	Vitest.stories(lifecycle, checks, manual, holds);
	Vitest.covers(membership, [lifecycle, checks, manual, holds]);
});

// The same decision through `handle`'s transaction on a Store. Here the Store keeps rows in
// memory; an app passes its database layer.
layer(Memberships.layer)('membership in its Store', (it) => {
	it.effect('a membership is granted once and revoked once', (ctx) =>
		Vitest.tell(ctx, lifecycle, Decision.against(lifecycle, Memberships, 'user-1'))
	);
});
```

`tell` records the tale's lines from the tale and the outcome from `run`. When `run` fails with an error other than a `StoryFailure` (a database error, say), the record has only `status: "failed"`.

## Writing the story record

Add the reporter next to Vitest's own in `vitest.config.ts`:

<!-- snippet: test/examples/vitest.config.ts#config -->
```ts
import { Vitest } from 'effect-storytime/testing';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		reporters: ['default', new Vitest.Reporter({ outputFile: 'reports/stories.json' })]
	}
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `outputFile` | `stories.json` | Where to write the report, relative to the Vitest root. Missing folders are created. |

Every run rewrites the file, and the same tests give the same bytes, so the file can be committed and diffed. Only tales told through `stories` or `tell` are recorded. `covers` records nothing, and neither does a test that calls `Story.run` itself.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `stories(...tales)` | `void` | One test per tale. |
| `covers(subject, tales)` | `void` | One coverage test. |
| `tell(ctx, tale, run?)` | `Effect<Reached, StoryFailure \| E, R>` | Runs and records a tale in your own test. |
| `Reporter` | class | `new Vitest.Reporter({ outputFile? })`, a Vitest reporter. |
| `ReporterOptions` | interface | `{ outputFile? }`. |
| `Told` | type | A record before the reporter adds `file` and `test`: what `tell` puts in `ctx.task.meta.storytime`. |
