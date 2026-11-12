# effect-storytime

A lean Effect 4 domain library with strict story tests (README.md). Design decisions live in `adrs/`.

## Gate

`pnpm check` must pass before anything lands: oxfmt, oxlint (type-aware, anti-slop vendored in `tools/oxlint`), tsc 7, Vitest at 100% coverage, Stryker at a 100% mutation score, then the build. It takes about two minutes.

- While iterating, mutate only what changed: `pnpm stryker run --mutate src/<File>.ts`.
- A surviving mutant needs a test that fails on it. Only a mutant that is truly equivalent gets `// Stryker disable next-line <Mutator>: <why no test can tell>`.
- `test/fixtures/report.json` is the reporter's exact output; delete it and rerun `test/reporter.test.ts` to regenerate it after a deliberate format change.

## Code

- Idiomatic Effect 4 at the version in the pnpm catalog; check APIs in its source, not memory.
- Two entries, each a namespace per public module: the domain in `src/index.ts` (modules in `src/`, internals in `src/internal/`) and the tales with the Vitest adapter in `src/testing/index.ts` (internals in `src/testing/internal/`). The domain imports nothing from `testing`; an oxlint `no-restricted-imports` rule enforces it.
- Tests import the public API by package name (`effect-storytime`, `effect-storytime/testing`), as consumers do; tsconfig `paths` point both at `src`.
- Scope is judged by general use cases: a building block stays if apps like this need it. infinite is a reference, not the measure.
- Examples shared by tests live in `test/examples/`, modelled on infinite's Chat, Conversation and membership code.

## Docs

- README.md pitches both libraries and links into `docs/`, one topic per file, written for coding agents that use the library. A change to the API or the story record updates README.md and the matching `docs/` page (`docs/README.md` maps topics to pages); a record format change also bumps `StoryReport`'s `version`.
- Every `ts` block in README.md and `docs/` follows a `<!-- snippet: <file>#<region> -->` marker and equals the `// #region <region>` of that file in `test/examples/` or `test/docs/`, so tsc, oxlint and Vitest check it. Change the code, then rewrite the blocks with `pnpm vitest run test/snippets.test.ts -u`; `test/snippets.test.ts` fails on any drift or unmarked block.

## Landing

Rebase on `main`, run the gate, then fast-forward `main` and push it.

## Release

Bump `version` in `package.json` on `main` in its own commit (0.x: a breaking change bumps the minor) and push it. On top of it, make the release commit outside `main`: `pnpm build`, `git add -f dist`, remove the `prepare` script (a git install would run it without dev dependencies), commit `Release vX.Y.Z`, tag it `vX.Y.Z` and push only the tag. Consumers pin `github:maxedapps/effect-storytime#vX.Y.Z`; README's Install names the newest tag.

npm publishing (as `effect-storytime`) waits for the `NPM_TOKEN` repository secret (from the `effect-storytime` prod vault). Once it exists, publishing a GitHub Release from a version tag runs `.github/workflows/publish.yml`, which runs `pnpm check` and publishes with provenance.
