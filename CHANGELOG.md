# Changelog

Notable changes to glimt. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and glimt uses [Semantic Versioning](https://semver.org/). While it is on 0.x, keys and commands may change between minor versions.

## [Unreleased]

## [0.7.0] - 2026-10-11

### Changed

- A session's name in bold now means it stopped or ended since you last reacted to it, wherever you did: opening it in any session's glimt pane, typing or sending a prompt in its own terminal, or pressing in its glimt pane there. Stopping it with `x` counts too. Before, only opening it in this pane took the bold off, so a session you worked with in its own terminal stayed bold. Each glimt shares when you reacted (never what you typed) through the plugin store.
- Short of room, an idle session in bold keeps its row instead of folding into `○ N idle`, and `+N more` gives up working rows and rows you have seen before one that waits or is in bold.
- Within each state, sessions are sorted by when they started, so a row moves only when its state changes.

## [0.6.3] - 2026-10-11

### Fixed

- After `l` into an agent or a session, the keys the key row shows were often typed into the message field instead of acting. When what the pane draws changes, Claude Code keeps its focus ring at the same place among the pane's elements, and that place could be the field. The ring now goes onto the way back (`← Overview`), and the field takes the keyboard only when you press `m` or Tab onto it.

## [0.6.2] - 2026-10-11

### Added

- A Cursor band color option for the band that marks the row you left while the keyboard is at the prompt or in one of glimt's forms. It takes a theme role or a color, and is `userMessageBackground` by default.

### Changed

- While the keyboard is at the prompt after Esc or in one of glimt's forms (a new agent, a new session or a new name), the row you left is marked by a quiet band across the pane, by default the theme's `userMessageBackground`, the background behind your messages, instead of its name staying inverse, as in a Neovim side panel. The inverse comes back with the keyboard. This goes for every row the cursor can be on: this session, steps, agents, other sessions and their agents.
- Closing the pane forgets the row the cursor was on and the agent or session it was in, so it opens again on the overview with no row marked.

### Fixed

- After `q` in the key list closed the pane, the chat went on leaving out the task-list rows and keeping a running agent's row to one line, until the pane was opened again.
- A form, the key list, or a clear or a stop waiting for y or n, left open when the pane closed, came back when the pane opened again. They now close with the pane.

## [0.6.1] - 2026-10-11

### Fixed

- Section headings are again bold in the terminal's own text color, as before 0.6.0, unless the Heading color option is set. In 0.6.0 they took the theme's `text` color by default, which can differ from it. The option's description now names every heading it colors.
- A background session that ended counted as idle, so one that had gone idle first ended without turning bold, its time still counting from when it went idle. Ending now starts a phase of its own: the name turns bold until you open it, and the time counts from the end.
- A session that failed or stopped sorts right after the working ones, so when the list runs short of room, `+N more` hides done and idle sessions before it.
- Short of room, a background session that ended, done, failed or stopped, was folded into the `○ N idle` line. It now keeps its row, which says how it ended.
- The form's `↵ start` and `↵ rename` hint takes the Quiet text color, as glimt's other quiet text does; only the keys, which are buttons, stay `inactive`.
- A short hex color, such as `#f80`, now goes to Claude Code as `#ff8800`, as an `rgb()` color does, so it no longer depends on how Claude Code reads short hex.
- The Mark color option's description, and the README, now say what it colors: the `☐` of a step to do and the `○` of another session that is idle or done, or of one of its agents gone quiet, also on the lines that fold them.
- Only color names, `ansi:` names and `ansi256()` from 0 to 15 follow the terminal's own palette. The README, and the notes for 0.6.0, said every `ansi256()` color did.

## [0.6.0] - 2026-10-11

### Added

- Quiet text color, Mark color and Heading color options, for glimt's quiet text, the marks of what is still to do or idle, and its section headings. Each takes a theme role or a color, and by default follows `/theme`.
- In a color option, a color name, `ansi256(n)` and `ansi:<name>` are drawn in the terminal's own palette.

### Changed

- The `☐` of a step to do, and the `○` of an idle or done session and of another session's quiet agent, are drawn in Claude Code's `inactive` color instead of `subtle`, which was nearly invisible on a dark background.
- glimt has a new icon: a calm control board where one lamp lights when something needs you.

## [0.5.0] - 2026-10-10

### Changed

- Keys follow Neovim's side panels: glimt binds only its own actions, and moving and opening are Claude Code's ↑ ↓, Tab and Enter. `j`, `k` and `o` are gone; `l` shows only on a row it can go into, and inside a session `h` sits on the line back, which names where it goes.

### Fixed

- An agent whose end glimt missed, as when the mod reloaded while it ended, showed as running for good, in this pane and in other sessions' panes. Every 5 seconds while it shows one as running, glimt now checks Claude Code's own list of the session's agents and ends any that list says ended or no longer lists.

## [0.4.0] - 2026-10-09

### Added

- A status row under this session's name, shown only when something is out of the ordinary: bypass permissions, a plan limit from 80% used with when it resets, or another session in the same folder.
- `same folder` on any session that shares its folder with another.
- A session never renamed goes by the title Claude Code gave it.
- Where another session runs glimt, its row shows `bypass` while it runs in bypass permissions and its context from 80% full; going into it names its permission mode.
- A background session that ended shows `done`, `✗ failed` or `■ stopped`.
- A notification when a background session finishes or fails, and a Notifications option to turn glimt's notifications off.
- Opening this session's row shows the main conversation's model and effort.

## [0.3.2] - 2026-10-09

### Fixed

- Each running call is followed on its own: an agent's ⎿ line shows the call still running when another ends first, and an approval mark ends with the call it belongs to, also when a hook rewrote the command or two calls wait at once.
- A session folder is written with `~` only when it is inside the home folder, not one that merely starts with its name.
- With glimt open in several terminals, a background session that starts waiting raised one notification per pane; now only one glimt on the machine notifies.
- CI copies the API types of the installed Claude Code version only.

## [0.3.1] - 2026-10-09

### Fixed

- The approval marks follow Claude Code's permission request instead of reading its permission decision, so the directory can confirm that glimt leaves every decision to you.

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

[Unreleased]: https://github.com/mmedum/glimt/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/mmedum/glimt/releases/tag/v0.7.0
[0.6.3]: https://github.com/mmedum/glimt/releases/tag/v0.6.3
[0.6.2]: https://github.com/mmedum/glimt/releases/tag/v0.6.2
[0.6.1]: https://github.com/mmedum/glimt/releases/tag/v0.6.1
[0.6.0]: https://github.com/mmedum/glimt/releases/tag/v0.6.0
[0.5.0]: https://github.com/mmedum/glimt/releases/tag/v0.5.0
[0.4.0]: https://github.com/mmedum/glimt/releases/tag/v0.4.0
[0.3.2]: https://github.com/mmedum/glimt/releases/tag/v0.3.2
[0.3.1]: https://github.com/mmedum/glimt/releases/tag/v0.3.1
[0.3.0]: https://github.com/mmedum/glimt/releases/tag/v0.3.0
[0.2.0]: https://github.com/mmedum/glimt/releases/tag/v0.2.0
[0.1.0]: https://github.com/mmedum/glimt/releases/tag/v0.1.0
