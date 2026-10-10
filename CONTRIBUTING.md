# Contributing to glimt

Thank you for helping. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

glimt is small and quiet on purpose, so a change starts as an issue: for anything past a typo, [open one](https://github.com/mmedum/glimt/issues) first, so we agree on the shape before you write code.

## Run it from your clone

You need Claude Code (CI tests with the version pinned in `.github/workflows/ci.yml`) and Node, for `npx`.

Start an interactive session with glimt loaded from your folder:

```sh
claude --plugin-dir .
```

That session also writes Claude Code's API types into `.claude-plugin/types/`, which the type-check needs.

## Checks

CI runs all of these with the same pinned versions. Run them before you open a pull request:

```sh
claude plugin validate --strict .
claude plugin test .
npx --yes -p typescript@7.0.2 tsc -p . --noEmit
npx --yes oxfmt@0.72.0 --check
npx --yes -p oxlint@1.87.0 -p oxlint-tsgolint@7.0.2003 oxlint --type-aware --deny-warnings hooks tests
npx --yes markdownlint-cli2@0.23.3
```

`npx --yes oxfmt@0.72.0` without `--check` formats the code and the Markdown.

## Code

- Everything that touches `$` lives in `hooks/register.tsx`. The other modules in `hooks/` are pure: they take values and return values or trees.
- Each `$.state` value is declared in `types/index.d.ts`.
- glimt is written in lowercase, always, also at the start of a sentence. Write American English.
- Comments say why, not what.

## Tests

- Test through the public surface: mount the pane, press its buttons, and raise the engine's events. `tests/kit.tsx` and `tests/machine.tsx` stand in for Claude Code and the machine.
- State expected values literally, one behavior per test.
- A test must be able to fail: break the code it covers and watch it fail.
- Fixtures use neutral names, never real session names or paths.

## Pull requests

- One change per pull request, linked to its issue.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything a user would notice.
- When glimt reads, runs or writes something new, add it to "How it works" in the README. That list must stay complete: it's what people, and the plugin directory, check glimt against.

## Releasing

For the maintainer:

1. Bump `version` in `.claude-plugin/plugin.json`. Installed copies only update when it changes.
2. In `CHANGELOG.md`, turn `[Unreleased]` into the version's section with today's date, and update the links at the bottom.
3. Commit, push and wait for CI.
4. Tag `vX.Y.Z` (annotated) and publish a GitHub Release with the version's section.

glimt follows [Semantic Versioning](https://semver.org/). While it is on 0.x, keys and commands may change between minor versions.
