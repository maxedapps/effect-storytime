# effect-storytime

An Effect 4 story-testing library (README.md). Design decisions live in `adrs/`.

## Gate

`pnpm check` must pass before anything lands: oxfmt, oxlint (type-aware, anti-slop vendored in `tools/oxlint`), tsc 7, Vitest at 100% coverage, Stryker at a 100% mutation score, then the build. It takes about two minutes.

- While iterating, mutate only what changed: `pnpm stryker run --mutate src/<File>.ts`.
- A surviving mutant needs a test that fails on it. Only a mutant that is truly equivalent gets `// Stryker disable next-line <Mutator>: <why no test can tell>`.
- `test/fixtures/report.json` is the reporter's exact output; delete it and rerun `test/reporter.test.ts` to regenerate it after a deliberate format change.

## Code

- Idiomatic Effect 4 at the version in the pnpm catalog; check APIs in its source, not memory.
- Every public module is a subpath export in `package.json` and a namespace in `src/index.ts`. Internals go in `src/internal/`.
- Examples shared by tests live in `test/examples/`, modelled on infinite's Chat, Conversation and membership code.
- A change to the API or the story record updates README.md; a record format change bumps `StoryReport`'s `version`.

## Landing

Rebase on `main`, run the gate, then fast-forward `main` and push it.

## Release

Releases go to npm as `effect-storytime`. Bump `version` in `package.json` on `main` in its own commit (0.x: a breaking change bumps the minor), push it, then tag that commit `vX.Y.Z` and push the tag: `.github/workflows/publish.yml` runs `pnpm check` and publishes with provenance, using the `NPM_TOKEN` repository secret (from the `effect-storytime` prod vault).
