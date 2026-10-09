<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img alt="glimt" src="docs/logo-light.svg" height="56">
  </picture>
</h1>

A quiet side pane for Claude Code: what this session is doing, its plan, its agents, and every other session.

_glimt_ is Danish for a glimpse, a brief flash of light. Say it like _glimpse_ without the _-pse_: GLIMT, with a short _i_.

![glimt beside a session: this session, Now, the plan with its steps, two agents at work, and three other sessions](docs/screenshot.png)

## Install

```
/plugin install glimt --marketplace mmedum/glimt
```

Needs Claude Code 2.1.289 or later in a terminal (2.1.295 for desktop notifications); tested with 2.1.295. Mods don't draw in the VS Code panel or with `-p`.

The pane opens by itself when the terminal is at least 144 columns wide. `/glimt` opens it at any width, with the keyboard.

Third-party marketplaces don't update on their own. To update, run `claude plugin update glimt@glimt` and restart Claude Code.

## Keys

The keys work while the pane holds the keyboard: open it with `/glimt`, click it, or press ctrl+x tab. The key row shows the keys that apply to the selected row; `i` lists them all.

| Key     | Does                                                                             |
| ------- | -------------------------------------------------------------------------------- |
| `j` `k` | move down and up (↓ ↑ and Tab work too)                                          |
| `l`     | go into an agent or a session: its task and live activity                        |
| `h`     | back out, one level at a time                                                    |
| `o`     | open or close the row: a step's description, an agent's task, a session's agents |
| `n`     | new agent here                                                                   |
| `s`     | new background session (`claude --bg`), from the `i` list                        |
| `r`     | rename this session, or another session running glimt                            |
| `c`     | clear this conversation, after asking                                            |
| `m`     | write to the agent or session you are in                                         |
| `a`     | copy a background session's `claude attach` command                              |
| `x`     | stop a background session, after asking                                          |
| `i`     | all keys                                                                         |
| `q`     | close the pane, from the `i` list                                                |

A spinner marks whatever is working right now: a running agent, a working session, the step in progress while Claude is on it. The rest keep still marks: `◉` waiting for you, `○` idle, `✓` done, `✗` failed, `■` stopped.

A waiting session says what it wants: `approve` for a permission prompt, `answer` for a question. Each other session shows how long it has been in its state, counted from when glimt saw that state begin, and its name turns bold when it stops, until you open it.

## How it works

Mods run with your permissions, so here is everything glimt touches. `claude plugin validate` lists the same.

- **This session:** it follows the session's tool calls, tasks and subagents through the mod API. While the task tools are on offer, it adds one sentence to the system prompt asking Claude to file sub-steps under their step (`metadata.parent`).
- **Other sessions:** it runs `claude agents --json` every 5 seconds while the pane is drawn. Under `~/.claude/projects/` it lists an open session's subagents every 5 seconds, and reads transcripts with `tail` and `head`, every 2 seconds while you are inside one.
- **Between sessions:** each session's glimt writes its running agents, and any rename it is asked to make, to Claude Code's plugin store.
- **Notifications:** when a background session starts waiting for you, glimt raises one notification through your own notification setting, or a toast where your terminal shows none; nothing if you turned notifications off. A session in a terminal of its own notifies from there.
- **Actions:** `claude --bg`, `claude stop`, `/rename` and `/clear`, only when you press their keys. `/rename` also runs when you rename this session from another session's glimt.
- **The chat:** while the pane is open, it leaves task-list rows out of the chat and keeps a running agent's row to one line.

It makes no network requests.

The plan comes from Claude's task list. Claude Code offers that list by default only on some models, and on every model in background sessions (agent view, or `claude --bg`); see [task tool availability](https://code.claude.com/docs/en/tools-reference#task-tool-availability). To have it in a terminal session on other models, start Claude Code with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. Without it, the plan says so and everything else works the same.

It can't switch this terminal to another session: Claude Code offers mods no way to do that ([#100519](https://github.com/anthropics/claude-code/issues/100519)). In an attached background session, ← on an empty prompt returns to agent view.

## Contributing

Questions and bugs: [open an issue](https://github.com/mmedum/glimt/issues). For a pull request, open an issue first.

Run the tests with `claude plugin test .` and check the manifests with `claude plugin validate --strict .`. Format with `npx oxfmt` and lint with `npx -p oxlint -p oxlint-tsgolint oxlint --type-aware hooks tests`; CI pins the versions. Claude Code writes the API types into `.claude-plugin/types/` when an interactive session loads the mod from its folder (`claude --plugin-dir .`); after that, `tsc -p .` type-checks it. CI gets the same types another way; see `.github/workflows/ci.yml`.

To release: bump `version` in `.claude-plugin/plugin.json` (installed copies only update when it changes), add the version's section to `CHANGELOG.md`, then tag `vX.Y.Z` and publish a GitHub Release with that section.

## License

[Apache-2.0](LICENSE) © 2026 Mark Medum Bundgaard
