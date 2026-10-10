# Security policy

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub instead: [report a vulnerability](https://github.com/mmedum/glimt/security/advisories/new), under the repository's Security tab.

Say which glimt and Claude Code versions you use, what someone could do with the problem, and how to reproduce it. glimt is maintained by one person, so allow a few days for an answer.

## What counts

glimt runs inside Claude Code with your permissions. These are in scope:

- glimt reading, running, writing or sending anything that [How it works](README.md#how-it-works) doesn't list.
- Another session's entry in Claude Code's plugin store making glimt do something, such as run a command or rename a session it shouldn't.
- glimt answering, or changing, a permission request. It must always hand the request on unchanged.

A problem in Claude Code itself goes to Anthropic, through [Claude Code's security policy](https://github.com/anthropics/claude-code/blob/main/SECURITY.md).
