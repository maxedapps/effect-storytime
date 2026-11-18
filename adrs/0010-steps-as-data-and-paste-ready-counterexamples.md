# 0010 Steps as data, a Markdown page, and paste-ready counterexamples

Status: Accepted

## Context

Task 4013 (research `research-4013-story-testing-review`, §2 and §6 items 2 and 6, approved by Max). The story record promises review without reading test code (`docs/story-record.md`), but each step is a line: a verb followed by canonical JSON in one string. Reviewers get walls of escaped JSON; infinite rejected showing them (its ADR 0679: 740 characters at the 90th percentile) and wrote its own parser and folder for them. Finals are lines too.

A failing exploration prints its counterexample as lines, and `docs/explorations.md` tells users to copy them into a story by hand. Lines are not code. Even retyped as code, a Program's counterexample is not a valid story: explorations owe no command assertions, so the story fails early at a cancel or restart of an unasserted command. A Decider's counterexample has no `accepted`/`rejected` after its `when`s, which a decision requires.

## Decision

1. **The record holds steps as data.** A record's `lines` become `steps`, each `{ verb, depth?, label?, values }`. `values` are the step's values in builder order (`resolve`'s command, then its reply). Each value is `{ tag?, value?, notJson? }`: its `_tag`, its canonical JSON without the tag (absent for a tag alone), or why it has no JSON. `final` and each `finals[].final` become such a value, and so does `final` in `Story.run`'s and `Decision.run`'s outcomes, which the Vitest adapter records. A failure's `counterexample` becomes steps, and a failure gains `code`. `StoryReport.version` becomes 4.
2. **Lines are rendered from the same data.** `StoryRecord.line(step)` makes the text every message and `Tale.lines` show, so lines and records cannot drift. `Tale.steps(tale)` gives a tale's steps, and `StoryRecord.Step`/`StoryRecord.Value` are their Schemas.
3. **`StoryRecord.markdown(report)` renders a report as a Markdown page**: one section per file, one per tale with its status, numbered steps (nested under `any order`), each value as its tag plus `key: value` fields, long values split one field per line, the finals and cases, and a failure with its problem, counterexample, replay token and code.
4. **A counterexample is a valid tale and comes as code.** An explored Program path asserts the pending commands right after each step that produced some, and an explored Decider path names each command's events or rejection before checking its properties, so the shrunk path runs as a story or decision and fails at the same step. `StoryFailure.code` holds it as `Story.make(...)` or `Decision.make(...)` source, built from the steps: one decoder per subject Schema the values use (`const model = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Model)))`), then each value as its canonical JSON string, as its line shows it, passed to its role's decoder, so brands, classes, dates and `Option`s come back as the tale had them. It uses the docs' names: the builders `story`/`decision` and the subject `program`/`decider`, which the user renames. The failure message ends with the code. Tales have no properties, so a pasted property failure runs past its failing step; the docs say to assert what the property checks there.

## Alternatives

- **Keep `lines` and add `steps` beside them**: two copies of every step in every record.
- **Values as canonical JSON with `_tag` inside, no separate tag**: every reader splits the tag out again, and the tag is what a reviewer reads first.
- **Nest `any order` steps**: a failure's `step` and a final's `order` number steps in reading order, which a flat list with `depth` keeps as an index.
- **An HTML page**: needs styling and escaping, and doesn't render in a terminal, a pull request or an agent's Markdown report. Markdown shows in all three.
- **Code printed from the typed values** (`Tag.make({...})`, `new Date(...)`, `Option.some(...)`): reads like hand-written code, but guesses each value's construction from its runtime shape. A branded field fails tsc and a `Schema.Class` instance becomes a plain object its Schema rejects. Decoding through the subject's Schemas is exact for every codec, at the price of encoded values (a bit for a boolean).
- **Values as object literals for the decoders** (`model({ _tag: "Ready", left: 2 })`): easier to edit, but every tagged value is a literal `_tag` object, which anti-slop's `no-manual-tagged-construction` rejects in the projects that lint with it. A JSON string reads like the value's line.
- **Code for every tale (`Story.code`)**: only counterexamples need it, and a `satisfies` check can't be printed.
- **A property as a pasted `satisfies`**: a property judges a whole update or ruling, a `satisfies` check one model or state, so none translates.
- **The subject's own variable name**: no Program or Decider knows it, and a name option only for printing would be API for one message.

## Consequences

- Record readers move to version 4: `lines` → `steps`, `final` and `finals[].final` become values. Code reading an outcome's `final` gets a value too.
- Counterexamples are longer: a Program's has `commands` lines, a Decider's its `accepted` and `rejected` lines. In exchange, each one runs as a story or decision once pasted.
- A Decider property now fails at the command's `accepted` or `rejected` step, one after its `when`.
- Pasted values are JSON strings in their encoded form, as lines and records show them; a user may rewrite them with `make` once pasted.
- infinite can drop its own line parsing and folding (`scripts/review/stories.ts`) for `StoryRecord.markdown` or the step data.
