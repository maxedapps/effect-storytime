# The story record

`import { StoryRecord } from 'effect-storytime/testing'`

With `Vitest.Reporter` in the Vitest config ([vitest.md](vitest.md)), every test run writes one JSON file, the `StoryReport`, holding a record of every tale it told. Use it to review behaviour without reading test code, to diff behaviour between commits, or as input for tools.

## The format

A report is `{ "version": 2, "stories": [...] }`, one record per told tale. The same tests give the same bytes: records are sorted by file, then test, then content, paths are posix and relative to the Vitest root, and there are no timings.

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `"Story" \| "Exploration" \| "Decision"` | Which kind of tale. |
| `title` | string | The tale's title. |
| `file` | string | The test file, posix and relative to the Vitest root. |
| `test` | string | The test's full name, its suites joined by ` > `. |
| `lines` | string[] | The tale's lines ([stories.md](stories.md#lines)). An exploration has one line naming its runs, steps and seed. |
| `status` | `"passed" \| "failed"` | |
| `final` | string, optional | The final model or state as a line, once a story or decision passed. |
| `cases` | string[], optional | The cases a passing tale touched, sorted, such as `Message.Asked` or `Rejection.NotActive`. |
| `failure` | object, optional | Present when the tale failed with a `StoryFailure`. |

`failure` holds the `StoryFailure` without its title: `step`, `line`, `message`, and optionally `expected`, `actual`, and for an exploration `counterexample` and `replay` ([explorations.md](explorations.md#running-and-failures)). A tale that failed with another error, such as a database error in `Decision.against`, has only `status: "failed"`.

A passing story, from [`test/fixtures/report.json`](../test/fixtures/report.json):

```json
{
  "kind": "Story",
  "title": "a question is stopped",
  "file": "stories/chat.stories.ts",
  "test": "chat > a question is stopped",
  "lines": [
    "given Ready {\"left\":1,\"turns\":[]}",
    "send Asked {\"text\":\"Why?\",\"turn\":\"t1\"}",
    "commands Ask {\"text\":\"Why?\",\"turn\":\"t1\"}",
    "send Stopped"
  ],
  "status": "passed",
  "final": "Ready {\"left\":1,\"turns\":[]}",
  "cases": ["Command.Ask", "Message.Asked", "Message.Stopped", "Model.Asking", "Model.Ready"]
}
```

## Reading a report

`StoryRecord.decode` reads the JSON text into a typed `StoryReport` and fails with a `SchemaError` for anything but a version 2 report:

<!-- snippet: test/docs/record.test.ts#decode -->
```ts
const text = yield* Effect.promise(() => readFile(path, 'utf8'));
// Fails with a SchemaError for anything but a version 2 report.
const report = yield* StoryRecord.decode(text);
const failed = report.stories.find((record) => record.status === 'failed');
```

A failed exploration's record, as decoded:

<!-- snippet: test/docs/record.test.ts#failed -->
```ts
expect(failed).toEqual({
	kind: 'Exploration',
	title: 'the lamp counts switches',
	file: 'checks/lamp.stories.ts',
	test: 'the lamp counts switches',
	lines: ['explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts'],
	status: 'failed',
	failure: {
		step: 2,
		line: 'explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts',
		message: 'invariant countIsSmall does not hold',
		actual: '{"at":"2026-11-04T00:00:00.000Z","count":10,"on":1}',
		// The shrunk path as a story; `step` numbers its failing line.
		counterexample: [
			'given {"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}',
			'send Switched {"at":"2026-11-04T00:00:00.000Z","by":10}'
		],
		// `Exploration.check(exploration, { replay })` checks just this path again.
		replay: '[1,"the lamp counts switches",13,4,[1,3,2],"PropertyError"]'
	}
});
```

## Versions

`version` changes whenever the record format does. Version 2 renamed a Decider's `Input` to `Command`, in its lines and its cases ([ADR 0003](../adrs/0003-lean-domain-library.md)). A tool that reads reports should decode with `StoryRecord.decode` and treat a decode failure as a report from another version.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `StoryReport` | Schema | `{ version: 2, stories: StoryRecord[] }`. |
| `StoryRecord` | Schema | One record. |
| `Failure` | Schema | A record's `failure`. |
| `decode(text)` | `Effect<StoryReport, SchemaError>` | Parses and decodes a report's JSON text. |
