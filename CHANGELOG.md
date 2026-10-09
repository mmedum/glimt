# Changelog

Notable changes to glimt. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and glimt uses [Semantic Versioning](https://semver.org/). While it is on 0.x, keys and commands may change between minor versions.

## [Unreleased]

## [0.3.0] - 2026-10-09

### Added

- An agent with a call waiting for your approval shows `◉` and `approve` with the tool, in this session and in other sessions running glimt.
- `x` stops an agent of this session that runs in the background, after asking, through Claude Code's `TaskStop`.
- Going into an agent or a session shows the model of its latest reply, and a session's git branch.
- Another session's row shows how far its plan has come, where it runs glimt.

## [0.2.0] - 2026-10-09

### Added

- A waiting session says what it wants: `approve` for a permission prompt, `answer` for a question.
- A session's name turns bold when it stops, until you open it.
- A notification when a background session starts waiting for you, through your own notification setting (Claude Code 2.1.295), or a toast where your terminal shows none.

### Changed

- A session's time counts from when glimt saw its state begin, not from when the session started; until glimt has seen that, the row shows no time.
- An empty plan says when Claude has no task list in the session; the README says how to turn it on.
- Needs Claude Code 2.1.289 or later; tested with 2.1.295.
- The code is checked with the strictest TypeScript settings, linted with oxlint (type-aware) and formatted with oxfmt, in CI too.

### Fixed

- A session in a terminal of its own that waits for you showed as idle; it now shows `◉` and sorts first.
- Inside another session's agent, the way back named the overview; it now names the session `h` returns to.

## [0.1.0] - 2026-10-09

### Added

- A docked side pane: this session, what is in progress now, the plan with sub-steps, the agents as a tree, and every other Claude Code session on the machine.
- `l` and `h` go into and back out of an agent, a session, or one of another session's agents, with its task and live activity.
- Another session's agents, read from its transcript folder, under the session when you open it.
- A message field for the agent or session you are in.
- New agents here (`n`) or as a background session (`s`), rename (`r`), clear (`c`), attach (`a`) and stop (`x`).
- The key list (`i`), a spinner on whatever is working with still marks for the rest, and a layout that keeps the sessions in place while agents come and go.

[Unreleased]: https://github.com/mmedum/glimt/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/mmedum/glimt/releases/tag/v0.3.0
[0.2.0]: https://github.com/mmedum/glimt/releases/tag/v0.2.0
[0.1.0]: https://github.com/mmedum/glimt/releases/tag/v0.1.0
