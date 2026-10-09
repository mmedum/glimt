// The other Claude Code sessions on the machine, and their agents: how they
// are listed, sorted and drawn.

import type { Phase, RemoteAgent, RemoteList, Session, SessionState, Shared, SharedAgent } from '../types'
import { TASK_LINES } from './agents'
import { runtime } from './state'
import { cells, clip, fit, fitStart, isRecord, minutes, spin, tildePath, toolName, wrap } from './text'
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
  const rank: Record<SessionState, number> = { waiting: 0, working: 1, idle: 2 }

  return list.toSorted((a, b) => rank[sessionState(a)] - rank[sessionState(b)])
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
        waitingFor: text(fields.waitingFor),
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
  phases: Record<string, Phase>
}

// The other Claude Code sessions on the machine in `room` rows, one line
// each, the ones waiting for their person first, with how long they have
// been in that state and how many agents their glimt says run; a name in
// bold stopped since the person last opened it. Opened, a session shows
// where it runs and its id, then its agents (l goes into the session, or
// into one of them); after x, it asks whether to stop it. Past the room,
// the idle ones fold into one line, then the rest are counted.
export function sessionSection(view: View, listing: Listing, room: number) {
  const { Box, Button, Text } = view.ui
  const { list, error, open, asked } = listing
  const all = list ?? []
  const waiting = all.filter(isSessionWaiting).length
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
    shown = all.filter(s => sessionState(s) !== 'idle' || isOpen(s))
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
          const phase = listing.phases[s.sessionId]
          const isUnseen = phase?.isUnseen === true
          const running = sharedOf(s).length
          const plan = listing.shared[s.sessionId]?.plan
          const progress = plan === undefined ? '' : ` · ${plan.done}/${plan.total}`
          const tally = `${stateText(word, phase, view.at)}${progress}${running === 0 ? '' : ` · ${running} ${running === 1 ? 'agent' : 'agents'}`}`

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
                  <Text dimColor={word === 'idle' && !isUnseen}>
                    {' '}
                    <Text color={color}>{mark}</Text>{' '}
                    <Text bold={isUnseen} inverse={view.cursor === `toggle-session-${s.sessionId}`}>
                      {fit(s.name, view.columns - 4 - cells(tally) - 1)}
                    </Text>
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

// Where a session runs, on which git branch where known, what kind it is and
// its id: "~/code on main · background · a1b2c3d4".
export function placeOf(s: Session, branch?: string): string {
  const where = tildePath(s.cwd, runtime.home)
  const on = branch === undefined ? '' : ` on ${branch}`

  return `${where}${on} · ${s.kind === 'background' ? 'background' : 'terminal'} · ${s.id ?? s.sessionId}`
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
      mark: remoteMark(view, a, share),
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
                  <Text color={line.mark.color}>{line.mark.mark}</Text>{' '}
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

// Another session's agent: ◉ while its glimt says it waits on its person,
// the spinner while it works, ○ once it is quiet.
export function remoteMark(view: View, a: RemoteAgent, share: SharedAgent | undefined): { mark: string; color: string } {
  if (share?.asking !== undefined) {
    return { mark: '◉', color: 'warning' }
  }

  return isRemoteActive(view, a, share) ? { mark: spin(view.at), color: 'claude' } : { mark: '○', color: 'subtle' }
}

// A running agent its glimt shares: its time and what it runs, or the tool it
// waits on its person to allow; any other, when its transcript was last
// written.
export function remoteTally(view: View, a: RemoteAgent, share: SharedAgent | undefined): string {
  if (share === undefined) {
    return `${minutes(view.at - a.writtenAt)} ago`
  }

  const doing =
    share.asking !== undefined
      ? `approve ${toolName(share.asking)}`
      : share.tool === undefined
        ? `${share.tools} ${share.tools === 1 ? 'tool' : 'tools'}`
        : toolName(share.tool)
  return `${minutes(view.at - share.startedAt)} · ${doing}`
}

// Waiting for its person: a background session says so as its state, any
// session as its status.
export function isSessionWaiting(s: Session): boolean {
  return s.state === 'blocked' || s.status === 'waiting'
}

export function isSessionBusy(s: Session): boolean {
  return !isSessionWaiting(s) && (s.status === 'busy' || s.state === 'working')
}

export function sessionState(s: Session): SessionState {
  return isSessionWaiting(s) ? 'waiting' : isSessionBusy(s) ? 'working' : 'idle'
}

// What a waiting session wants of its person, by why it waits: a
// permission prompt or a sandbox request an approval, a question an answer.
const WANTS: Record<string, 'approve' | 'answer'> = { 'permission prompt': 'approve', 'sandbox request': 'approve', 'input needed': 'answer' }

// A session's mark and word: the spinner while it works, ◉ while it waits
// for its person, ○ while it idles. The word says it again without color,
// and a waiting session's says what it wants, where it says why it waits.
export function sessionMark(s: Session, at: number): { mark: string; color: string; word: string } {
  const state = sessionState(s)
  if (state === 'waiting') {
    return { mark: '◉', color: 'warning', word: WANTS[s.waitingFor ?? ''] ?? 'waiting' }
  }

  return state === 'working' ? { mark: spin(at), color: 'claude', word: 'working' } : { mark: '○', color: 'subtle', word: 'idle' }
}

// The word, and how long the session has been in its state when glimt saw
// that state begin: "idle · 4m", or "idle".
export function stateText(word: string, phase: Phase | undefined, at: number): string {
  return phase?.since === undefined ? word : `${word} · ${minutes(at - phase.since)}`
}

// The sessions' phases after a read at `at`. A session glimt meets for the
// first time is in a phase of unknown age; one whose state changed starts a
// phase now, unseen if it stopped; a session no longer listed is dropped.
export function nextPhases(before: Record<string, Phase>, list: Session[], at: number): Record<string, Phase> {
  return Object.fromEntries(
    list.map(s => {
      const state = sessionState(s)
      const was = before[s.sessionId]
      const phase: Phase =
        was === undefined ? { state, isUnseen: false } : was.state === state ? was : { state, since: at, isUnseen: state !== 'working' }
      return [s.sessionId, phase]
    }),
  )
}

// Whether this session's glimt is the one on the machine to tell of
// `waiting`: of the panes drawn, the one whose session id sorts first, the
// waiting session's own left out. Every glimt reaches the same answer from
// the shares, so one notification goes out, not one per pane.
export function isNotifier(selfId: string | null, waiting: string, shared: Record<string, Shared>): boolean {
  return Object.entries(shared).every(([id, share]) => share.watching !== true || id === waiting || id > (selfId ?? ''))
}

// What a notification says of a session that started waiting.
export function waitingNote(s: Session): string {
  const wants = WANTS[s.waitingFor ?? '']

  return wants === 'approve'
    ? `${s.name} needs your approval`
    : wants === 'answer'
      ? `${s.name} has a question for you`
      : `${s.name} is waiting for you`
}
