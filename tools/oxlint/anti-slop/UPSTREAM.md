# anti-slop source snapshot

Vendored from https://github.com/dmmulroy/anti-slop at commit
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` on 2026-09-11, copied from `skills/install-anti-slop/assets/anti-slop/`.
Upstream tests are not included. The MIT license is included in this directory.

Removed from the snapshot: the `require-readable-spacing` rule and its only dependency, the vendored
ESLint Stylistic `padding-line-between-statements` (`vendor/eslint-stylistic/`). `oxlint.config.ts` never
enabled the rule.
