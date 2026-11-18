# Vitest

`import { Vitest } from 'effect-storytime/vitest'`

The Vitest adapter has its own entry, so `effect-storytime/testing` loads neither Vitest nor Node's `fs` and runs in any test runner or tool. The adapter registers tales as `@effect/vitest` tests and records each told tale in its test's meta. Its `Reporter` collects those records into one JSON file, the story record ([story-record.md](story-record.md)). It needs `vitest` 5.1 and `@effect/vitest` 4.1.2 as dev dependencies.

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
| `breaks(subject, states)` | Registers one test, named `each invariant breaks alone`, that runs `Tale.breaks`: each invariant must break on the state given for it, and only that invariant ([tales-and-covers.md](tales-and-covers.md#breaks)). |
| `tell(ctx, tale, run?)` | Runs a tale inside your own `it.effect`, records it in the test's meta and fails the test when it fails. Pass `run` when the tale needs services. |

`covers` and `breaks` always use the same test names, so give each subject its own `describe` when one file covers several.

## One describe per rule

Group a subject's tales by the rule they pin down: one `describe` per rule, named by it, holding the rule's happy path and its rejections or error cases. A failing test then names the rule it broke, and a rule with no `describe` stands out as untested. The subject's `covers` stays at the top, since it counts all of its tales:

<!-- snippet: test/docs/membership.test.ts#rules -->
```ts
// One describe per rule, holding every tale about it, so a failing test names the rule it broke.
describe('membership', () => {
	describe('a membership is granted once and revoked once', () => {
		Vitest.stories(lifecycle);
	});
	describe('a check changes only what it finds changed', () => {
		// The rule's rejection sits beside its happy path.
		Vitest.stories(checks, manual);
	});
	describe('an active membership has been checked', () => {
		// The invariant can fail, and no path of commands breaks it.
		Vitest.breaks(membership, {
			checkedWhenActive: { source: 'teachable', active: true, checkedAt: null }
		});
		Vitest.stories(holds);
	});
	Vitest.covers(membership, [lifecycle, checks, manual, holds]);
});
```

`tell` records the tale's lines from the tale and the outcome from `run`. When `run` fails with an error other than a `StoryFailure` (a database error, say), the record has only `status: "failed"`.

## Writing the story record

Add the reporter next to Vitest's own in `vitest.config.ts`:

<!-- snippet: test/examples/vitest.config.ts#config -->
```ts
import { Vitest } from 'effect-storytime/vitest';
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

Every run rewrites the file, and the same tests give the same bytes, so the file can be committed and diffed. Only tales told through `stories` or `tell` are recorded. `covers` and `breaks` record nothing, and neither does a test that calls `Story.run` itself.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `stories(...tales)` | `void` | One test per tale. |
| `covers(subject, tales)` | `void` | One coverage test. |
| `breaks(subject, states)` | `void` | One test that each invariant can fail. |
| `tell(ctx, tale, run?)` | `Effect<Reached, StoryFailure \| E, R>` | Runs and records a tale in your own test. |
| `Reporter` | class | `new Vitest.Reporter({ outputFile? })`, a Vitest reporter. |
| `ReporterOptions` | interface | `{ outputFile? }`. |
| `Told` | type | A record before the reporter adds `file` and `test`: what `tell` puts in `ctx.task.meta.storytime`. |
