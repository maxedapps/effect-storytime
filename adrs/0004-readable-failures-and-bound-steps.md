# 0004 Readable failures and subject-bound step builders

Status: Accepted

## Context

Task 3293's library review found two things that make tales harder to use than they should be:

- A failing tale reads poorly in Vitest. `StoryFailure.message` holds only the problem ("invariant leftIsNeverNegative does not hold"); the step, its line, the state that broke a rule, an exploration's counterexample and its replay token appear only in the logged error. The code frame points into the library (`Story.ts`, `Exploration.ts`), and in a consumer's project at `node_modules`, never at the tale.
- Step builders are free generic functions (`Story.send<Model, Message, Command>`) that infer their types only inside `Story.make`. A step built anywhere else, such as a shared group or a helper that maps commands to `resolve` steps, needs the three type parameters spelled out; infinite repeats them at 7+ sites. Decision's builders have the same shape and the same gap.

Separately, `Loop.dispatch` hangs forever once the Loop's scope has closed: it enqueues a delivery nobody takes and awaits it.

## Decision

1. **`StoryFailure.message` is the whole failure.** The field that held the problem becomes `problem`, and `message` renders the problem, `step N: <line>`, the state (`actual`) when there is nothing to compare it with, an exploration's numbered counterexample with the failing step marked, and its replay token. A failure with both `expected` and `actual` keeps them out of the message: Vitest (like every runner following the AssertionError convention) diffs them. `StoryRecord.Failure` follows the fields, so the record's `version` becomes 3.
2. **A failure's stack is the tale's call site.** `Story.make`, `Decision.make`, `Exploration.make` and `Exploration.decisions` capture the stack of their caller (`Error.captureStackTrace`), kept beside the tale in a `WeakMap`, so the tale value stays plain data. Every `StoryFailure` a tale fails with carries that stack, so Vitest's code frame shows the user's `make` call, which `step N: <line>` then narrows down.
3. **`Story.of(program)` and `Decision.of(decider)` give the step builders, bound to the subject's types.** The free builders go: one way to build steps, typed anywhere. `Story.make(title, program, ...steps)` and `Decision.make` stay as they are.
4. **Closing a Loop's scope ends it cleanly.** Messages already dispatched are applied, then the commands are interrupted; a dispatch after that is interrupted at once instead of hanging. The Loop keeps that order in its own sequential child scope, so a caller's parallel scope can't interrupt the commands mid-drain.

## Alternatives

- **Keep the free builders next to `of`**: two ways to write every step, and the free ones still fail outside `make`.
- **Bound builders that also carry `make`** (`Story.of(chat).make(title, ...)`): a second constructor for the same value.
- **Point the stack at each failing step**, captured in every builder: an exact frame, at the cost of a capture per step and a hidden site on each step value; `step N: <line>` already names the step.
- **A `site` field on each tale**: visible in the public value and in its equality, though it is no part of what the tale tells.
- **Put `expected`/`actual` into the message too**: Vitest would show both twice.
- **Leave the stack alone**: the code frame keeps pointing into the library.
- **A Loop that interrupts pending dispatches on close** instead of applying them: breaks `dispatch`'s promise for messages it already accepted, and needs extra bookkeeping to reach every waiting caller.

## Consequences

- The next minor release breaks every tale: `Story.given(...)` becomes `story.given(...)` after `const story = Story.of(chat)`, and the record's `failure.message` becomes `failure.problem` (version 3). Infinite migrates when it repins.
- Vitest's FAIL block alone tells what failed, where, and how to replay it, with a code frame at the tale.
