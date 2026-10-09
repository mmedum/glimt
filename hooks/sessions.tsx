// The other Claude Code sessions on the machine, and their agents: how they
// are listed, sorted and drawn.

import type { RemoteAgent, RemoteList, Session, Shared, SharedAgent } from '../types'
import { TASK_LINES } from './agents'
import { runtime } from './state'
import { cells, clip, fit, fitStart, isRecord, minutes, spin, toolName, wrap } from './text'
import { heading } from './view'
import type { View } from './view'

// Shared agents are written again this often unchanged, so a reader can tell
// a quiet session from one whose glimt has gone: older than STALE_MS, a
// share is not shown.
export const HEARTBEAT_MS = 30_000
export const STALE_MS = 60_000

// The most of an agent's task another session is shown.
export const SHARED_TASK = 400

// Another session's subagents: the newest REMOTE_KEPT are read, REMOTE_SHOWN
// drawn; one whose transcript was written within ACTIVE_MS counts as at
// work, unless its session's glimt says which run.
export const REMOTE_KEPT = 20
export const REMOTE_SHOWN = 6
export const ACTIVE_MS = 60_000

export function isShared(value: unknown): value is Shared {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const share = value as { at?: unknown; agents?: unknown }
  return typeof share.at === 'number' && Array.isArray(share.agents)
}

// Waiting for its person first, then working, then idle; the list's order
// within each.
export function sortSessions(list: Session[]): Session[] {
  const rank = (s: Session) => (s.state === 'blocked' ? 0 : isSessionBusy(s) ? 1 : 2)

  return list.toSorted((a, b) => rank(a) - rank(b))
}

// The sessions in what `claude agents --json` printed; an entry with no
// sessionId is left out.
export function parseSessions(value: unknown): Session[] {
  if (!Array.isArray(value)) {
    throw new Error('not a list')
  }

  const text = (field: unknown) => (typeof field === 'string' ? field : undefined)
  return value.flatMap((item: unknown) => {
    const fields = isRecord(item) ? item : {}
    const sessionId = text(fields.sessionId)
    if (sessionId === undefined) {
      return []
    }

    return [
      {
        sessionId,
        id: text(fields.id),
        name: text(fields.name) ?? sessionId.slice(0, 8),
        cwd: text(fields.cwd) ?? '',
        kind: text(fields.kind) ?? 'session',
        status: text(fields.status),
        state: text(fields.state),
        pid: typeof fields.pid === 'number' ? fields.pid : undefined,
        startedAt: typeof fields.startedAt === 'number' ? fields.startedAt : 0,
      },
    ]
  })
}

// A background session can be attached to and stopped from here; one in a
// terminal of its own is reached in that terminal. The footer offers a and x
// for the first kind only.
export function isReachable(s: Session): s is Session & { id: string } {
  return s.kind === 'background' && s.id !== undefined
}

export type Listing = {
  // The other sessions, sorted; null before the first read.
  list: Session[] | null
  error: string | null
  // What their glimts share, by session id.
  shared: Record<string, Shared>
  // Their subagents as read, by session id, and the tasks of those opened.
  remote: Record<string, RemoteList>
  tasks: Record<string, string>
  open: readonly string[]
  asked: string | null
  answer: (isYes: boolean) => void
}

// The other Claude Code sessions on the machine in `room` rows, one line
// each, the ones waiting for their person first, with how many agents their
// glimt says run. Opened, a session shows where it runs and its id, then
// its agents (l goes into the session, or into one of them); after x, it
// asks whether to stop it. Past the room, the idle ones fold into one line,
// then the rest are counted.
export function sessionSection(view: View, listing: Listing, room: number) {
  const { Box, Button, Text } = view.ui
  const { list, error, open, asked } = listing
  const all = list ?? []
  const waiting = all.filter(s => s.state === 'blocked').length
  const working = all.filter(isSessionBusy).length
  const count = [waiting > 0 ? `${waiting} waiting` : '', working > 0 ? `${working} working` : ''].filter(part => part !== '').join(' · ')

  const sharedOf = (s: Session) => listing.shared[s.sessionId]?.agents ?? []
  const crews = new Map(
    all.map(s => [
      s.sessionId,
      open.includes(`session:${s.sessionId}`)
        ? remoteSection(view, s, { list: listing.remote[s.sessionId], shared: sharedOf(s), tasks: listing.tasks, open })
        : undefined,
    ]),
  )
  const rowsOf = (s: Session) => {
    const crew = crews.get(s.sessionId)
    return 1 + (crew === undefined ? 0 : 1 + crew.rows) + (asked === s.sessionId ? 1 : 0)
  }
  const total = (shown: Session[]) => shown.reduce((sum, s) => sum + rowsOf(s), 0)
  const budget = room - 1 - (error === null ? 0 : 1)
  // An opened session stays on show, whatever else folds.
  const isOpen = (s: Session) => crews.get(s.sessionId) !== undefined
  let shown = all
  let idle = 0
  if (total(shown) > budget) {
    shown = all.filter(s => s.state === 'blocked' || isSessionBusy(s) || isOpen(s))
    idle = all.length - shown.length
  }
  let hidden = 0
  const extra = () => (idle > 0 ? 1 : 0) + (hidden > 0 ? 1 : 0)
  while (total(shown) + extra() > budget) {
    const last = shown.map(isOpen).lastIndexOf(false)
    if (last === -1) {
      break
    }
    shown = shown.filter((_, i) => i !== last)
    hidden += 1
  }
  const notes = (error === null ? 0 : 1) + (list === null && error === null ? 1 : 0) + (list !== null && list.length === 0 ? 1 : 0)

  return {
    rows: 1 + Math.max(1, notes + total(shown) + extra()),
    toggles: shown.flatMap(s => [
      { key: `toggle-session-${s.sessionId}`, target: `session:${s.sessionId}` },
      ...(crews.get(s.sessionId)?.toggles ?? []),
    ]),
    node: (
      <Box flexDirection="column">
        {heading(view, 'sessions-heading', 'Sessions', count)}
        {error !== null && (
          <Box key="sessions-error">
            <Text color="error">{fit(error, view.columns)}</Text>
          </Box>
        )}
        {list === null && error === null && (
          <Box key="no-sessions">
            <Text dimColor>Reading the sessions…</Text>
          </Box>
        )}
        {list !== null && list.length === 0 && (
          <Box key="no-sessions">
            <Text dimColor>No other sessions.</Text>
          </Box>
        )}
        {shown.map(s => {
          const crew = crews.get(s.sessionId)
          const { mark, color, word } = sessionMark(s, view.at)
          const running = sharedOf(s).length
          const tally = `${word} · ${minutes(view.at - s.startedAt)}${running === 0 ? '' : ` · ${running} ${running === 1 ? 'agent' : 'agents'}`}`

          return (
            <Box key={`session-${s.sessionId}`} flexDirection="column">
              <Box flexDirection="row">
                <Button
                  key={`toggle-session-${s.sessionId}`}
                  plain
                  label={crew === undefined ? '▸' : '▾'}
                  onPress={() => view.toggle(`session:${s.sessionId}`)}
                />
                <Box flexGrow={1}>
                  <Text dimColor={word === 'idle'}>
                    {' '}
                    <Text color={color}>{mark}</Text>{' '}
                    <Text inverse={view.cursor === `toggle-session-${s.sessionId}`}>{fit(s.name, view.columns - 4 - cells(tally) - 1)}</Text>
                  </Text>
                </Box>
                <Text dimColor> {tally}</Text>
              </Box>
              {asked === s.sessionId && (
                <Box key={`stop-${s.sessionId}`} flexDirection="row" columnGap={2} paddingLeft={4}>
                  <Text color="warning">{fit(`Stop ${s.name}?`, view.columns - 20)}</Text>
                  <Button key="stop-yes" plain hotkey="y" label="yes" onPress={() => listing.answer(true)} />
                  <Button key="stop-no" plain hotkey="n" label="no" onPress={() => listing.answer(false)} />
                </Box>
              )}
              {crew !== undefined && (
                <Box key={`session-detail-${s.sessionId}`} flexDirection="column">
                  <Text dimColor>
                    {'  ⎿ '}
                    {fitStart(placeOf(s), view.columns - 4)}
                  </Text>
                  {crew.node}
                </Box>
              )}
            </Box>
          )
        })}
        {idle > 0 && (
          <Box key="sessions-idle">
            <Text dimColor>
              {'  '}○ {idle} idle
            </Text>
          </Box>
        )}
        {hidden > 0 && (
          <Box key="sessions-more">
            <Text dimColor>+{hidden} more</Text>
          </Box>
        )}
      </Box>
    ),
  }
}

// Where a session runs, what kind it is and its id: "~/code · background · a1b2c3d4".
export function placeOf(s: Session): string {
  const where = runtime.home !== '' && s.cwd.startsWith(runtime.home) ? `~${s.cwd.slice(runtime.home.length)}` : s.cwd

  return `${where} · ${s.kind === 'background' ? 'background' : 'terminal'} · ${s.id ?? s.sessionId}`
}

export type RemoteState = { list: RemoteList | undefined; shared: SharedAgent[]; tasks: Record<string, string>; open: readonly string[] }

// Another session's subagents, under it: the newest REMOTE_SHOWN written,
// then how many are older. One at work spins: its session's glimt says it
// runs, or its transcript changed within ACTIVE_MS; the rest say when they
// last wrote. Opened, an agent shows its task.
export function remoteSection(view: View, s: Session, state: RemoteState) {
  const { Box, Button, Text } = view.ui
  const { list, shared, tasks, open } = state
  const sid = s.sessionId
  if (list === undefined || list.total === 0) {
    return {
      rows: 1,
      toggles: [],
      node: (
        <Box key={`remote-${sid}`}>
          <Text dimColor>{list === undefined ? '  └─ Reading its agents…' : '  └─ No agents.'}</Text>
        </Box>
      ),
    }
  }

  const shown = list.agents.slice(0, REMOTE_SHOWN)
  const older = list.total - shown.length
  const lines = shown.map((a, i) => {
    const share = shared.find(one => one.id === a.id)
    const target = `remote:${sid}:${a.id}`
    const text = tasks[`${sid}:${a.id}`] ?? share?.task
    const task = !open.includes(target)
      ? []
      : text === undefined
        ? ['Loading…']
        : text === ''
          ? ['No task text.']
          : clip(wrap(text, view.columns - 7), TASK_LINES)
    return {
      a,
      target,
      task,
      key: `toggle-remote-${sid}-${a.id}`,
      isActive: isRemoteActive(view, a, share),
      tally: remoteTally(view, a, share),
      branch: i === shown.length - 1 && older === 0 ? '  └─ ' : '  ├─ ',
    }
  })

  return {
    rows: lines.reduce((sum, line) => sum + 1 + line.task.length, 0) + (older > 0 ? 1 : 0),
    toggles: lines.map(line => ({ key: line.key, target: line.target })),
    node: (
      <Box key={`remote-${sid}`} flexDirection="column">
        {lines.map(line => (
          <Box key={`remote-${sid}-${line.a.id}`} flexDirection="column">
            <Box flexDirection="row">
              <Text dimColor>{line.branch}</Text>
              <Button key={line.key} plain label={line.task.length > 0 ? '▾' : '▸'} onPress={() => view.toggle(line.target)} />
              <Box flexGrow={1}>
                <Text dimColor={!line.isActive}>
                  {' '}
                  <Text color={line.isActive ? 'claude' : 'subtle'}>{line.isActive ? spin(view.at) : '○'}</Text>{' '}
                  <Text inverse={view.cursor === line.key}>
                    {fit(`${line.a.type} ${line.a.description}`, view.columns - 9 - cells(line.tally) - 1)}
                  </Text>
                </Text>
              </Box>
              <Text dimColor> {line.tally}</Text>
            </Box>
            {line.task.map(text => (
              <Text dimColor>
                {'       '}
                {text}
              </Text>
            ))}
          </Box>
        ))}
        {older > 0 && (
          <Box key={`remote-older-${sid}`}>
            <Text dimColor>{`  └─ +${older} older`}</Text>
          </Box>
        )}
      </Box>
    ),
  }
}

export function isRemoteActive(view: View, a: RemoteAgent, share: SharedAgent | undefined): boolean {
  return share !== undefined || view.at - a.writtenAt <= ACTIVE_MS
}

// A running agent its glimt shares: its time and what it runs; any other,
// when its transcript was last written.
export function remoteTally(view: View, a: RemoteAgent, share: SharedAgent | undefined): string {
  if (share === undefined) {
    return `${minutes(view.at - a.writtenAt)} ago`
  }

  const doing = share.tool === undefined ? `${share.tools} ${share.tools === 1 ? 'tool' : 'tools'}` : toolName(share.tool)
  return `${minutes(view.at - share.startedAt)} · ${doing}`
}

export function isSessionBusy(s: Session): boolean {
  return s.state !== 'blocked' && (s.status === 'busy' || s.state === 'working')
}

// A session's mark and word: the spinner while it works, ◉ while it waits
// for its person, ○ while it idles. The word says it again without color.
export function sessionMark(s: Session, at: number): { mark: string; color: string; word: string } {
  if (s.state === 'blocked') {
    return { mark: '◉', color: 'warning', word: 'waiting' }
  }

  return isSessionBusy(s) ? { mark: spin(at), color: 'claude', word: 'working' } : { mark: '○', color: 'subtle', word: 'idle' }
}
