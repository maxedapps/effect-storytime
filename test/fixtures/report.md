# Stories

8 tales: 5 passed, 3 failed.

## checks/lamp.stories.ts

### ✗ the lamp counts switches

Exploration · failed

- 1 **explore** 100 runs of up to 30 steps, seed "the lamp counts switches", with restarts

**Failed at step 2 of the counterexample:** invariant countIsSmall does not hold

Actual:
```text
{"at":"2026-11-04T00:00:00.000Z","count":10,"on":1}
```

Counterexample:

- 1 **given** `at: "2026-11-03T00:00:00.000Z", count: 0, on: 0`
- 2 ✗ **send** Switched `at: "2026-11-04T00:00:00.000Z", by: 10`

Replay: `[1,"the lamp counts switches",13,4,[1,3,2],"PropertyError"]`

As code:
```ts
const model = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Model)));
const message = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(program.Message)));
Story.make(
	"the lamp counts switches",
	program,
	story.given(model('{"at":"2026-11-03T00:00:00.000Z","count":0,"on":0}')),
	story.send(message('{"_tag":"Switched","at":"2026-11-04T00:00:00.000Z","by":10}'))
)
```

### ✓ two switches leave the lamp off, in either order

Story · passed

- 1 **given** `at: "2026-11-03T00:00:00.000Z", count: 0, on: 0`
- 2 **any order**
  - 3 **send** Switched `at: "2026-11-04T00:00:00.000Z", by: 1`
  - 4 **send** Switched `at: "2026-11-04T00:00:00.000Z", by: 2`
- 5 **satisfies** off

**Ends in order 3, 4** `at: "2026-11-04T00:00:00.000Z", count: 3, on: 0`

**Ends in order 4, 3** `at: "2026-11-04T00:00:00.000Z", count: 3, on: 0`

**Cases** Message.Switched

## checks/membership.stories.ts

### ✓ only an active membership is revoked

Decision · passed

- 1 **given** `active: 0, checkedAt: null, source: "teachable"`
- 2 **when** Revoke
- 3 **rejected** NotActive

**Ends** `active: 0, checkedAt: null, source: "teachable"`

**Cases** Command.Revoke, Rejection.NotActive

### ✓ a membership starts inactive

Decision · passed · test: tells tales in any order

- 1 **given** `active: 0, checkedAt: null, source: "teachable"`

**Ends** `active: 0, checkedAt: null, source: "teachable"`

### ✗ only an active membership is revoked

Decision · failed · test: tells tales in any order

- 1 **given** `active: 0, checkedAt: null, source: "teachable"`
- 2 **when** Revoke
- 3 **rejected** NotActive

### ✓ only an active membership is revoked

Decision · passed · test: tells tales in any order

- 1 **given** `active: 0, checkedAt: null, source: "teachable"`
- 2 **when** Revoke
- 3 **rejected** NotActive

**Ends** `active: 0, checkedAt: null, source: "teachable"`

**Cases** Command.Revoke, Rejection.NotActive

## stories/chat.stories.ts

### ✗ a question is forgotten

Story · failed · test: chat > a question is forgotten

- 1 **given** Ready `left: 1, turns: []`
- 2 **send** Asked `text: "Why?", turn: "t1"`
- 3 ✗ **commands** none

**Failed at step 3:** the pending commands differ

Expected:
```text

```

Actual:
```text
Ask {"text":"Why?","turn":"t1"}
```

### ✓ a question is stopped

Story · passed · test: chat > a question is stopped

- 1 **given** Ready `left: 1, turns: []`
- 2 **send** Asked `text: "Why?", turn: "t1"`
- 3 **commands** Ask `text: "Why?", turn: "t1"`
- 4 **send** Stopped

**Ends** Ready `left: 1, turns: []`

**Cases** Command.Ask, Message.Asked, Message.Stopped, Model.Asking, Model.Ready
