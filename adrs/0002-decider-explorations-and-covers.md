# 0002 Decider explorations and covers

Status: Accepted

## Context

In 0.1, only a Program can be explored (`Exploration.make`) and covered (`Tale.covers`). Decisions report no cases, so a Decider's rules are checked only on the paths someone wrote down. Infinite is moving its database rules (membership checks, badge awards) onto Deciders, tested with `Decision.against` on PGlite. Max chose (task 2309, #29667) to add Decider explorations and covers before that migration, in this library and under its gate. He also asked for a new version to be tagged without an npm publish and pinned in infinite.

## Decision

1. **`Exploration.decisions(title, decider, options?)`** generates paths: a start state (`given`, by default the Decider's `initial`) and then inputs (`when`, by default any input the Input Schema allows), decided one after another. `runs`, `steps` and `seed` work as they do for Programs. Each path runs the same strict rules as a decision: Schema validity, `decide` and `evolve` run twice on copies, JSON copies, and invariants after every input. A rejection is a valid outcome, not a failure. A failing path shrinks to the lines of a decision ending at the `when` that broke, with `step` and a `replay` token.
2. **One `Exploration` class for both.** Each constructor turns its options into one `Arbitrary` of walks: each walk is an Effect that gives the cases it touched or fails where it broke. `check` runs these walks the same way for a Program or a Decider. The class loses its type parameters, because nothing outside the constructors reads them.
3. **A Decider's cases** are `State.X`, `Input.X`, `Event.X` and `Rejection.X`, taken from each of its Schemas that is a tagged union. This is the same rule a Program's Model already follows. Every state an input's events pass through counts, not only the last, so a state that one input enters and leaves is still reached. `Decision.run` and `Decision.against` now return the cases they touched, and decision records carry them. `Tale.cases` and `Tale.covers` take a Program or a Decider, and so does the Vitest adapter's `covers`.
4. **One strict-rule module for Deciders** (`internal/decider.ts`). Decisions and explorations share `strict`, `checks` and `caser`. `decideIn` (the code behind `handle` and `against`) returns the whole ruling (what was decided and the state it reached), so `against` can record cases too.
5. **`covers` takes any tales and counts only the subject's own.** `tales` is `ReadonlyArray<Tale>`, not a per-subject union. Each tale names its subject (a story its Program, a decision or an exploration its Program or Decider), and `covers` runs only the tales whose subject is the one covered. Two subjects can share case names, so a type alone couldn't stop another subject's tales from covering this one.
6. **Release 0.2.0 as a git tag.** The `Exploration` type and the `covers` signature change, so the minor version is bumped. Until the npm token exists, the tagged commit carries the built `dist/`, as v0.1.0's did. The publish workflow runs on a published GitHub Release instead of a pushed `v*` tag. That way, pushing a tag never starts a publish that fails without the token, and publishing to npm stays a deliberate step.

## Alternatives

- **A separate `DecisionExploration` class.** It would duplicate the property check, the failure mapping and the summary line. A single walk type keeps one `check`.
- **Overloading `Exploration.make` for both.** Telling a Program's options from a Decider's inside the implementation would need type assertions. A second constructor named after what it generates (`decisions`) is plainer.
- **Typed tale unions in `covers`**, with overloads per subject. The Vitest adapter can't forward an overloaded call without a third, untyped signature, which brings back exactly what the overloads were meant to remove. A type also can't tell two Deciders apart when their Schemas match.
- **Failing on another subject's tales** instead of skipping them. That adds an error for a mistake `Uncovered` already exposes, since skipped tales leave their cases missing.
- **Leaving the publish trigger on tags and pushing the tag anyway.** That shows a red workflow run on the public repository for every release until the token exists. **Not tagging at all**, with infinite pinning a commit SHA, gives consumers no readable version.

## Consequences

- Infinite can explore its membership and badge Deciders and require their tales to cover every case, in memory and against PGlite.
- 0.2.0 breaks code that names `Exploration<…>` with type arguments, or that passes typed tale arrays to `covers` with explicit type arguments. Infinite doesn't use 0.1 yet.
- Publishing to npm needs a GitHub Release created from a version tag once `NPM_TOKEN` exists.
