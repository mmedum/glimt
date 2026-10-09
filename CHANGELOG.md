# Changelog

Notable changes to glimt. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and glimt uses [Semantic Versioning](https://semver.org/). While it is on 0.x, keys and commands may change between minor versions.

## [Unreleased]

## [0.1.0] - 2026-10-09

### Added

- A docked side pane: this session, what is in progress now, the plan with sub-steps, the agents as a tree, and every other Claude Code session on the machine.
- `l` and `h` go into and back out of an agent, a session, or one of another session's agents, with its task and live activity.
- Another session's agents, read from its transcript folder, under the session when you open it.
- A message field for the agent or session you are in.
- New agents here (`n`) or as a background session (`s`), rename (`r`), clear (`c`), attach (`a`) and stop (`x`).
- The key list (`i`), a spinner on whatever is working with still marks for the rest, and a layout that keeps the sessions in place while agents come and go.

[Unreleased]: https://github.com/mmedum/glimt/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mmedum/glimt/releases/tag/v0.1.0
