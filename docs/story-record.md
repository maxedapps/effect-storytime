# The story record

`import { StoryRecord } from 'effect-storytime/testing'`

With `Vitest.Reporter` in the Vitest config ([vitest.md](vitest.md)), every test run writes one JSON file, the `StoryReport`, holding a record of every tale it told. Use it to review behaviour without reading test code, to diff behaviour between commits, or as input for tools.

## The format

A report is `{ "version": 4, "stories": [...] }`, one record per told tale. The same tests give the same bytes: records are sorted by file, then test, then content, paths are posix and relative to the Vitest root, and there are no timings.

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `"Story" \| "Exploration" \| "Decision"` | Which kind of tale. |
| `title` | string | The tale's title. |
| `file` | string | The test file, posix and relative to the Vitest root. |
| `test` | string | The test's full name, its suites joined by ` > `. |
| `steps` | Step[] | The tale's steps, in the order of its lines ([stories.md](stories.md#lines)). An exploration has one step naming its runs, steps and seed. |
| `status` | `"passed" \| "failed"` | |
| `finals` | object[], optional | Where a passing story ended: one `{ order, final }` per order its `anyOrder`s ran in, in the order they ran. `order` holds the step numbers of the `anyOrder` steps as that order ran them, empty without an `anyOrder`, and `final` is the final model as a value. |
| `final` | Value, optional | The final state, once a decision passed. |
| `cases` | string[], optional | The cases a passing tale touched, sorted, such as `Message.Asked` or `Rejection.NotActive`. |
| `failure` | object, optional | Present when the tale failed with a `StoryFailure`. |

`failure` holds the `StoryFailure` without its title: `step`, `line`, `problem`, and optionally `expected`, `actual`, and for an exploration `counterexample` (steps), `replay` and `code` ([explorations.md](explorations.md#running-and-failures)). A tale that failed with another error, such as a database error in `Decision.against`, has only `status: "failed"`.

## Steps and values

A step is `{ verb, depth?, label?, values }`:

| Field | Meaning |
| --- | --- |
| `verb` | The builder that made it, such as `send`, `commands`, `resolve`, `when`, `accepted` or `satisfies`, or `any order` and `explore`. |
| `depth` | How many `anyOrder`s it is inside; absent at the top. |
| `label` | A `satisfies` step's label, or an exploration's settings. |
| `values` | Its values in the builder's order: a `resolve`'s command, then the reply. Empty for `commands` and `accepted` that list none. |

A value is `{ tag?, value?, notJson? }`: its `_tag`, its canonical JSON without the tag (absent for a tag alone, such as `Stopped`), or why it has no JSON. `StoryRecord.line(step)` shows a step as the line a failure message prints.

A passing story with an `anyOrder`, from [`test/fixtures/report.json`](https://github.com/maxedapps/effect-storytime/blob/main/test/fixtures/report.json). Its two orders end alike; a story whose orders end apart passes too, unless a step after the `anyOrder` asserts the model, and its `finals` show each ending:

```json
{
  "kind": "Story",
  "title": "two switches leave the lamp off, in either order",
  "file": "checks/lamp.stories.ts",
  "test": "two switches leave the lamp off, in either order",
  "steps": [
    { "verb": "given", "values": [{ "value": { "at": "2026-11-03T00:00:00.000Z", "count": 0, "on": 0 } }] },
    { "verb": "any order", "values": [] },
    { "verb": "send", "depth": 1, "values": [{ "tag": "Switched", "value": { "at": "2026-11-04T00:00:00.000Z", "by": 1 } }] },
    { "verb": "send", "depth": 1, "values": [{ "tag": "Switched", "value": { "at": "2026-11-04T00:00:00.000Z", "by": 2 } }] },
    { "verb": "satisfies", "label": "off", "values": [] }
  ],
  "status": "passed",
  "finals": [
    { "order": [3, 4], "final": { "value": { "at": "2026-11-04T00:00:00.000Z", "count": 3, "on": 0 } } },
    { "order": [4, 3], "final": { "value": { "at": "2026-11-04T00:00:00.000Z", "count": 3, "on": 0 } } }
  ],
  "cases": ["Message.Switched"]
}
```

## Reading a report

`StoryRecord.decode` reads the JSON text into a typed `StoryReport` and fails with a `SchemaError` for anything but a version 4 report:

<!-- snippet: test/docs/record.test.ts#decode -->
```ts
const text = yield* Effect.promise(() => readFile(path, 'utf8'));
// Fails with a SchemaError for anything but a version 4 report.
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
	steps: [
		{
			verb: 'explore',
			label: '100 runs of up to 30 steps, seed "the lamp counts switches", with restarts',
			values: []
		}
	],
	status: 'failed',
	failure: {
		step: 2,
		line: 'explore 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts',
		problem: 'invariant countIsSmall does not hold',
		actual: '{"at":"2026-11-04T00:00:00.000Z","count":10,"on":1}',
		// The shrunk path as steps; `step` numbers its failing one.
		counterexample: [
			{
				verb: 'given',
				values: [{ value: { at: '2026-11-03T00:00:00.000Z', count: 0, on: 0 } }]
			},
			{
				verb: 'send',
				values: [{ tag: 'Switched', value: { at: '2026-11-04T00:00:00.000Z', by: 10 } }]
			}
		],
		// `Exploration.check(exploration, { replay })` checks just this path again.
		replay: '[1,"the lamp counts switches",13,4,[1,3,2],"PropertyError"]',
		// The same path as a story to paste into a test, its values decoded by the program's Schemas.
		code: [
			'const model = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Model)));',
			'const message = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Message)));',
			'Story.make(',
			'\t"the lamp counts switches",',
			'\tprogram,',
			`\tstory.given(model('{"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}')),`,
			`\tstory.send(message('{"_tag":"Switched","at":"2026-11-04T00:00:00.000Z","by":10}'))`,
			')'
		].join('\n')
	}
});
```

## A page to review

`StoryRecord.markdown(report)` renders a report as Markdown: a section per test file, and per tale its status, its numbered steps with each value as its tag and fields, where it ended and the cases it touched. A failed tale shows its problem, `expected` and `actual`, and for an exploration the counterexample with `✗` at the failing step, the replay token and the code. Values too wide for one line show as JSON blocks.

<!-- snippet: test/docs/record.test.ts#markdown -->
```ts
const report = yield* StoryRecord.decode(text);
const page = StoryRecord.markdown(report);
```

## Versions

`version` changes whenever the record format does. Version 2 renamed a Decider's `Input` to `Command`, in its lines and its cases ([ADR 0003](https://github.com/maxedapps/effect-storytime/blob/main/adrs/0003-lean-domain-library.md)). Version 3 renamed a failure's `message` to `problem` ([ADR 0004](https://github.com/maxedapps/effect-storytime/blob/main/adrs/0004-readable-failures-and-bound-steps.md)). Version 4 replaced `lines` with `steps`, made `final`, each `finals[].final` and a counterexample's steps data, and added a failure's `code` ([ADR 0010](https://github.com/maxedapps/effect-storytime/blob/main/adrs/0010-steps-as-data-and-paste-ready-counterexamples.md)). A tool that reads reports should decode with `StoryRecord.decode` and treat a decode failure as a report from another version.

## API

| Export | Kind | Meaning |
| --- | --- | --- |
| `StoryReport` | Schema | `{ version: 4, stories: StoryRecord[] }`. |
| `StoryRecord` | Schema | One record. |
| `Step` | Schema | A step: `{ verb, depth?, label?, values }`. |
| `Value` | Schema | A value: `{ tag?, value?, notJson? }`. |
| `Failure` | Schema | A record's `failure`. |
| `Final` | Schema | One of a record's `finals`: `{ order, final }`. |
| `decode(text)` | `Effect<StoryReport, SchemaError>` | Parses and decodes a report's JSON text. |
| `markdown(report)` | `string` | The report as a Markdown page to review. |
| `line(step)` | `string` | A step as its line, such as `send Asked {"text":"Why?","turn":"t1"}`. |
