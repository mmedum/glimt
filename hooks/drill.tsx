// Going into an agent or a session with l: what it is doing, read from its
// transcript, drawn alone in the pane with a field to write to it.

import type { Activity, Agent, Feed, Opened, RemoteAgent, RemoteList, Session, SharedAgent } from '../types'
import { AGENT_MARK, agentTally, runningMark } from './agents'
import { isReachable, isRemoteActive, placeOf, remoteSection, remoteTally, sessionMark } from './sessions'
import { cells, clip, describeCall, fit, fitStart, isRecord, minutes, spin, toolName, wrap } from './text'
import { heading, keyButton, keyWidth, wrappedRows } from './view'
import type { View } from './view'

export const TAIL_BYTES = 131_072
export const FEED_KEPT = 200

// The most lines a drilled-into agent's task takes above its activity.
export const TASK_SHOWN = 4

// The items in a transcript's lines: the person's prompts (or a subagent's
// task), Claude's text and its calls. A line cut by the tail, a line Claude
// Code added itself, text it wrapped in a tag (a command, a reminder, a
// notification) and, in a session's own transcript, a subagent's line are
// left out.
export function parseTranscript(text: string, isSubagent = false): Activity[] {
  return text.split('\n').flatMap(line => {
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      return []
    }
    if (!isRecord(entry)) {
      return []
    }

    const { type, message, isSidechain, isMeta } = entry
    if ((isSidechain === true && !isSubagent) || isMeta === true || (type !== 'user' && type !== 'assistant')) {
      return []
    }
    const content = isRecord(message) ? message.content : undefined
    const blocks: unknown[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []

    return blocks.flatMap((block): Activity[] => {
      const fields = isRecord(block) ? block : {}
      if (fields.type === 'text' && typeof fields.text === 'string' && isShownText(fields.text)) {
        return [{ kind: type === 'user' ? 'asked' : 'said', text: fields.text.trim() }]
      }
      if (type === 'assistant' && fields.type === 'tool_use' && typeof fields.name === 'string') {
        return [{ kind: 'call', text: callLine(fields.name, fields.input) }]
      }
      return []
    })
  })
}

export function isShownText(text: string): boolean {
  const trimmed = text.trim()

  return trimmed !== '' && !trimmed.startsWith('<')
}

// "Read · /a/b.ts": the tool, and what the call is on when it says.
export function callLine(tool: string, input: unknown): string {
  const on = describeCall(typeof input === 'object' && input !== null ? input : {})

  return on === undefined ? toolName(tool) : `${toolName(tool)} · ${on}`
}

export type Drill = {
  into: Opened
  // What the pane is in, each undefined once it is gone: one of this
  // session's agents, another session (also the one of an agent of it), or
  // another session's agent.
  agent: Agent | undefined
  session: Session | undefined
  remoteAgent: RemoteAgent | undefined
  // The session's agents as read, what its glimt shares, and whether it
  // runs one at all (to take a new name).
  remote: RemoteList | undefined
  shared: SharedAgent[]
  isSharing: boolean
  tasks: Record<string, string>
  open: readonly string[]
  feed: Feed | null
  asked: string | null
  isFocused: boolean
  // The rows docked; undefined inline, where nothing is cut.
  room: number | undefined
  act: {
    back: () => void
    into: () => void
    down: () => void
    up: () => void
    open: () => void
    message: () => void
    send: (to: { sessionId: string } | { agentId: string }, name: string, text: string) => void
    rename: () => void
    attach: () => void
    stop: () => void
    answer: (isYes: boolean) => void
    help: () => void
  }
}

// The most activity items drawn inline, where the pane has no height to fill.
export const FEED_INLINE = 20

// What l went into, alone in the pane as Claude Code's agent view shows a
// session: the way back, the agent or the session with what it does now, a
// session's agents (j, k, o and l work on them), an agent's task, its latest
// activity (newest last, as much as the rows left hold), a field for a
// message to it, and the keys while the pane holds the keyboard.
export function drillSection(view: View, drill: Drill) {
  const { Box, Button, Text } = view.ui
  const { Input } = view
  const { into, agent, session, remoteAgent, shared, feed: got, asked, act } = drill
  const width = view.columns
  const isGone = into.kind === 'agent' ? agent === undefined : into.kind === 'session' ? session === undefined : remoteAgent === undefined

  // The title, and the dim lines under it: what it does now, and where.
  let title: { mark: string; color: string; name: string } | undefined
  let facts: string[] = []
  let taskText: string | undefined
  if (into.kind === 'agent' && agent !== undefined) {
    const { mark, color } = agent.state === 'running' ? runningMark(view.at) : AGENT_MARK[agent.state]
    title = { mark, color, name: `${agent.type} ${agent.description}` }
    facts = [agentTally(view, agent, true)]
    if (agent.state === 'running' && agent.tool !== undefined) {
      const tool = toolName(agent.tool)
      const room = width - 2 - cells(tool) - 5
      const on = agent.doing === undefined ? '' : /^[/~]/.test(agent.doing) ? fitStart(agent.doing, room) : fit(agent.doing, room)
      facts.push(on === '' ? `⎿ ${tool}` : `⎿ ${tool} · ${on}`)
    }
    taskText = agent.task
  } else if (into.kind === 'session' && session !== undefined) {
    const { mark, color, word } = sessionMark(session, view.at)
    title = { mark, color, name: session.name }
    facts = [`${word} · ${minutes(view.at - session.startedAt)}`, fitStart(`⎿ ${placeOf(session)}`, width - 2)]
  } else if (into.kind === 'remote' && remoteAgent !== undefined) {
    const share = shared.find(one => one.id === remoteAgent.id)
    const isActive = isRemoteActive(view, remoteAgent, share)
    title = { mark: isActive ? spin(view.at) : '○', color: isActive ? 'claude' : 'subtle', name: `${remoteAgent.type} ${remoteAgent.description}` }
    facts = [remoteTally(view, remoteAgent, share), fit(`⎿ in ${session?.name ?? 'another session'}`, width - 2)]
    taskText = drill.tasks[`${into.sessionId}:${remoteAgent.id}`] ?? share?.task
  }
  const task =
    into.kind === 'session' || isGone
      ? []
      : taskText === undefined
        ? ['Loading…']
        : clip(
            taskText.split('\n').flatMap(paragraph => wrap(paragraph, width - 2)),
            TASK_SHOWN,
          )
  const crew =
    into.kind === 'session' && session !== undefined
      ? remoteSection(view, session, { list: drill.remote, shared, tasks: drill.tasks, open: drill.open })
      : undefined
  const isAsking = into.kind === 'session' && session !== undefined && asked === session.sessionId

  const canMessage =
    Input !== undefined &&
    !isGone &&
    (into.kind === 'session' || (into.kind === 'agent' && agent?.state === 'running' && agent.agentId !== undefined))
  const canWalk = crew !== undefined && crew.toggles.length > 0
  const canReach = into.kind === 'session' && session !== undefined && isReachable(session)
  const canRename = into.kind === 'session' && session !== undefined && drill.isSharing
  // The keys, as the overview pairs them: j, k, l and o only where there are
  // agents to walk, h always; each with the cells it takes, to count the
  // rows the row wraps to.
  const pair = keyWidth('↓') + 1 + keyWidth('↑')
  const keyItems = drill.isFocused
    ? [
        ...(canWalk
          ? [
              {
                width: pair,
                node: (
                  <Box key="key-walk" flexDirection="row" columnGap={1}>
                    {keyButton(view, 'down', 'j', '↓', act.down)}
                    {keyButton(view, 'up', 'k', '↑', act.up)}
                  </Box>
                ),
              },
              {
                width: pair,
                node: (
                  <Box key="key-go" flexDirection="row" columnGap={1}>
                    {keyButton(view, 'back', 'h', '←', act.back)}
                    {keyButton(view, 'into', 'l', '→', act.into)}
                  </Box>
                ),
              },
              { width: keyWidth('open'), node: keyButton(view, 'open', 'o', 'open', act.open) },
            ]
          : [{ width: keyWidth('← back'), node: keyButton(view, 'back', 'h', '← back', act.back) }]),
        ...(canMessage ? [{ width: keyWidth('message'), node: keyButton(view, 'message', 'm', 'message', act.message) }] : []),
        ...(canRename ? [{ width: keyWidth('rename'), node: keyButton(view, 'rename', 'r', 'rename', act.rename) }] : []),
        ...(canReach
          ? [
              { width: keyWidth('attach'), node: keyButton(view, 'attach', 'a', 'attach', act.attach) },
              { width: keyWidth('stop'), node: keyButton(view, 'stop', 'x', 'stop', act.stop) },
            ]
          : []),
        { width: keyWidth('keys'), node: keyButton(view, 'help', 'i', 'keys', act.help) },
      ]
    : undefined
  const keyRows =
    keyItems === undefined
      ? 0
      : 1 +
        wrappedRows(
          keyItems.map(item => item.width),
          width,
          3,
        )

  // The activity takes the rows the rest leaves: the way back and a blank,
  // the title and its lines, a session's agents or an agent's task under a
  // heading, the activity's heading, the field and the keys, each with a
  // blank above.
  const fixed =
    2 +
    (isGone ? 1 : 1 + facts.length + (isAsking ? 1 : 0)) +
    (crew === undefined ? 0 : 2 + crew.rows) +
    (task.length === 0 ? 0 : 2 + task.length) +
    2 +
    (canMessage ? 2 : 0) +
    keyRows
  const room = drill.room === undefined ? Infinity : Math.max(3, drill.room - fixed)
  const items = got === null ? [] : drill.room === undefined ? got.items.slice(-FEED_INLINE) : got.items
  const shown = lastItems(items, width, room)

  return {
    toggles: crew?.toggles ?? [],
    node: (
      <Box key="drill" flexDirection="column">
        <Button key="back" plain dimColor label="← Overview" onPress={act.back} />
        <Box key="drill-title" flexDirection="column" marginTop={1}>
          {title === undefined ? (
            <Text dimColor>{into.kind === 'session' ? 'This session is no longer listed.' : 'This agent is no longer listed.'}</Text>
          ) : (
            <Text>
              <Text color={title.color}>{title.mark}</Text> <Text bold>{fit(title.name, width - 2)}</Text>
            </Text>
          )}
          {facts.map(line => (
            <Text dimColor>
              {'  '}
              {line}
            </Text>
          ))}
          {isAsking && session !== undefined && (
            <Box key={`stop-${session.sessionId}`} flexDirection="row" columnGap={2} paddingLeft={2}>
              <Text color="warning">{fit(`Stop ${session.name}?`, width - 20)}</Text>
              <Button key="stop-yes" plain hotkey="y" label="yes" onPress={() => act.answer(true)} />
              <Button key="stop-no" plain hotkey="n" label="no" onPress={() => act.answer(false)} />
            </Box>
          )}
        </Box>
        {crew !== undefined && (
          <Box key="drill-agents" flexDirection="column" marginTop={1}>
            {heading(
              view,
              'drill-agents-heading',
              'Agents',
              drill.remote === undefined || drill.remote.total === 0 ? '' : String(drill.remote.total),
            )}
            {crew.node}
          </Box>
        )}
        {task.length > 0 && (
          <Box key="drill-task" flexDirection="column" marginTop={1}>
            {heading(view, 'task-heading', 'Task', '')}
            {task.map(line => (
              <Text dimColor>
                {'  '}
                {line}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {heading(view, 'activity-heading', 'Activity', '')}
          <Box key="activity" flexDirection="column">
            {got === null ? (
              <Text dimColor>Reading…</Text>
            ) : got.error !== undefined ? (
              <Text color="error">{fit(got.error, width)}</Text>
            ) : shown.length === 0 ? (
              <Text dimColor>Nothing yet.</Text>
            ) : (
              shown.flatMap(({ item, lines }) =>
                lines.map(line => (
                  <Text bold={item.kind === 'asked'} dimColor={item.kind === 'call'}>
                    {line}
                  </Text>
                )),
              )
            )}
          </Box>
        </Box>
        {canMessage && Input !== undefined && (
          <Box marginTop={1}>
            <Input
              key="message-field"
              label="Message"
              placeholder="Type and press Enter"
              value=""
              submitLabel="send"
              onSubmit={text =>
                agent?.agentId !== undefined
                  ? act.send({ agentId: agent.agentId }, `${agent.type} ${agent.description}`, text)
                  : session !== undefined && act.send({ sessionId: session.sessionId }, session.name, text)
              }
            />
          </Box>
        )}
        {keyItems !== undefined && (
          <Box key="keys" flexDirection="row" flexWrap="wrap" columnGap={3} marginTop={1}>
            {keyItems.map(item => item.node)}
          </Box>
        )}
      </Box>
    ),
  }
}

// An activity item's lines: a call on one, dim, under ⎿ as Claude Code nests
// a call; what was asked (›) on up to two and what Claude said (●) on up to
// three, wrapped.
export function itemLines(item: Activity, width: number): string[] {
  if (item.kind === 'call') {
    return [fit(`  ⎿ ${item.text}`, width)]
  }

  const lead = item.kind === 'asked' ? '› ' : '● '
  return wrap(item.text, width - 2, item.kind === 'asked' ? 2 : 3).map((line, i) => `${i === 0 ? lead : '  '}${line}`)
}

// The newest items that fit in `room` rows, oldest first; the newest alone
// cut to the room when even it does not fit.
export function lastItems(items: Activity[], width: number, room: number): { item: Activity; lines: string[] }[] {
  const shown: { item: Activity; lines: string[] }[] = []
  let used = 0
  for (const item of items.toReversed()) {
    const lines = itemLines(item, width)
    if (used + lines.length > room) {
      if (shown.length === 0) {
        shown.push({ item, lines: lines.slice(0, room) })
      }
      break
    }
    shown.unshift({ item, lines })
    used += lines.length
  }

  return shown
}
