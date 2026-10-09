// This session's agents: the main conversation and its subagents as a tree.

import type { ModelUsage } from 'claude-code'
import type { Agent, AgentState, Focus, RunningCall } from '../types'
import { cells, clip, duration, fit, fitStart, minutes, spin, tokenNumber, toolName, wrap } from './text'
import { heading } from './view'
import type { View } from './view'

// Finished agents stay on show below the running ones until a new request,
// the newest this many, as room allows.
export const FINISHED_SHOWN = 6

// Below this many columns an agent's time and tools take a line of their own.
export const NARROW = 50

// A row's title keeps at least this many cells: a count in words that would
// leave less is shortened.
export const MIN_TITLE = 12

export type Spawned = {
  agentId?: string | undefined
  fallbackId: string
  parentId?: string | undefined
  type: string
  description: string
  task: string
  model?: string | undefined
  isBackground?: boolean | undefined
}

export function isTurnRunning(request: Focus | null): boolean {
  return request?.startedAt !== undefined && request.endedAt === undefined
}

// The main conversation drawn as the first agent, once a turn has started.
export function mainAgent(request: Focus | null): Agent | undefined {
  if (request?.startedAt === undefined) {
    return undefined
  }

  return {
    id: 'main',
    type: 'Claude',
    description: 'main conversation',
    task: '',
    state: isTurnRunning(request) ? 'running' : (request.outcome ?? 'done'),
    startedAt: request.startedAt,
    endedAt: request.endedAt,
    tools: request.tools ?? 0,
    tool: request.tool,
    doing: request.doing,
    tokens: request.tokens,
    percent: request.percent,
  }
}

export function contextTokens(usage: ModelUsage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
}

// What runs spins; a finished agent keeps a still mark: ✓ done, and a failed
// or stopped one a shape of its own, so each reads without its color.
export function runningMark(at: number) {
  return { mark: spin(at), color: 'claude' }
}

// x stops an agent that runs in the background, as a plugin's own always
// does; Claude Code stops no other kind from a plugin.
export function isStoppable(agent: Agent): boolean {
  return agent.state === 'running' && agent.isBackground === true && agent.agentId !== undefined
}

// A call put to the agent's person shows as waiting once it has waited this
// long, so a call the mode decides at once never flashes.
export const ASK_SHOWN_MS = 1000

// A loop's calls after one starts or ends: the latest names its tool and
// what it is on.
export function withCalls<T extends { calls?: RunningCall[] | undefined; tool?: string | undefined; doing?: string | undefined }>(
  item: T,
  calls: RunningCall[],
): T {
  const latest = calls.at(-1)
  return { ...item, calls, tool: latest?.tool, doing: latest?.on }
}

// The call Claude Code is about to ask the person about: of that tool, the
// one on the same thing, else the latest not asked yet (a hook may have
// rewritten what it is on), now waiting since `at`.
export function askCall(calls: RunningCall[], tool: string, on: string | undefined, at: number): RunningCall[] {
  const open = calls.filter(call => call.tool === tool && call.askedAt === undefined)
  const asked = open.find(call => call.on === on) ?? open.at(-1)
  return asked === undefined ? calls : calls.map(call => (call === asked ? { ...call, askedAt: at } : call))
}

// The call a running agent has waited on its person for the longest, once
// that has lasted ASK_SHOWN_MS by `at`.
export function askingOf(at: number, agent: Agent): RunningCall | undefined {
  if (agent.state !== 'running') {
    return undefined
  }

  return (agent.calls ?? []).find(call => call.askedAt !== undefined && at - call.askedAt >= ASK_SHOWN_MS)
}

// An agent's mark: ◉ while it waits on its person, the spinner while it
// runs, a still mark once it has finished.
export function agentMark(view: View, agent: Agent): { mark: string; color: string } {
  if (agent.state !== 'running') {
    return AGENT_MARK[agent.state]
  }

  return askingOf(view.at, agent) === undefined ? runningMark(view.at) : { mark: '◉', color: 'warning' }
}

// After ⎿: the call that waits on its person, "approve Bash · npm test", or
// else the latest running call and what it is on.
export function callOf(agent: Agent, asking: RunningCall | undefined, room: number): string | undefined {
  if (agent.state !== 'running') {
    return undefined
  }

  const call = asking ?? (agent.tool === undefined ? undefined : { tool: agent.tool, on: agent.doing })
  if (call === undefined) {
    return undefined
  }

  const tool = `${asking === undefined ? '' : 'approve '}${toolName(call.tool)}`
  const space = room - cells(tool) - 5
  const on = call.on === undefined ? '' : /^[/~]/.test(call.on) ? fitStart(call.on, space) : fit(call.on, space)
  return on === '' ? `⎿ ${tool}` : `⎿ ${tool} · ${on}`
}

export const AGENT_MARK: Record<Exclude<AgentState, 'running'>, { mark: string; color: string }> = {
  done: { mark: '✓', color: 'success' },
  failed: { mark: '✗', color: 'error' },
  stopped: { mark: '■', color: 'warning' },
}

// The most lines an opened agent's task takes.
export const TASK_LINES = 12

// One agent as the tree draws it: `branch` leads its row, `stem` leads the
// rows of its children, and the lines under it continue the stem.
export type AgentNode = { agent: Agent; branch: string; stem: string; isMain: boolean; hasChildren: boolean }

// The running agents, the newest finished, and every agent above one of
// those, so no row hangs without the agent that spawned it.
export function shownAgents(team: Agent[]): Agent[] {
  const byAgentId = new Map<string, Agent>()
  for (const agent of team) {
    if (agent.agentId !== undefined) {
      byAgentId.set(agent.agentId, agent)
    }
  }

  const wanted = [...team.filter(a => a.state === 'running'), ...team.filter(a => a.state !== 'running').slice(-FINISHED_SHOWN)]
  const keep = new Set<string>()
  for (const agent of wanted) {
    let at: Agent | undefined = agent
    while (at !== undefined && !keep.has(at.id)) {
      keep.add(at.id)
      at = at.parentId === undefined ? undefined : byAgentId.get(at.parentId)
    }
  }

  return team.filter(a => keep.has(a.id))
}

// The tree in spawn order: the main conversation at the root, each agent
// under the one that spawned it; one whose parent is not on show hangs from
// the root.
export function agentTree(main: Agent | undefined, shown: Agent[]): AgentNode[] {
  const ids = new Set(shown.flatMap(a => (a.agentId === undefined ? [] : [a.agentId])))
  const parentOf = (a: Agent) => (a.parentId !== undefined && ids.has(a.parentId) ? a.parentId : undefined)
  const childrenOf = (parent: string | undefined) => shown.filter(a => parentOf(a) === parent)
  const nodes: AgentNode[] = []

  const grow = (parent: string | undefined, stem: string, isBranched: boolean) => {
    const children = childrenOf(parent)
    children.forEach((agent, i) => {
      const isLast = i === children.length - 1
      const branch = isBranched ? `${stem}${isLast ? '└─ ' : '├─ '}` : stem
      const below = isBranched ? `${stem}${isLast ? '   ' : '│  '}` : stem
      const hasChildren = agent.agentId !== undefined && childrenOf(agent.agentId).length > 0
      nodes.push({ agent, branch, stem: below, isMain: false, hasChildren })
      if (agent.agentId !== undefined) {
        grow(agent.agentId, below, true)
      }
    })
  }

  if (main !== undefined) {
    nodes.push({ agent: main, branch: '', stem: '', isMain: true, hasChildren: childrenOf(undefined).length > 0 })
  }
  grow(undefined, '', main !== undefined)

  return nodes
}

// The lines an agent's row carries under it, each led by the stem: its time
// and tools on a narrow pane, what its running call is on (after ⎿, as
// Claude Code nests a call's lines), its opened task.
export function agentLines(view: View, node: AgentNode, open: readonly string[], isTight = false) {
  const { agent } = node
  const under = underOf(node)
  const width = view.columns - cells(under)
  const lines: string[] = []

  if (view.columns < NARROW) {
    lines.push(fit(tallyOf(view, node), width))
  }
  // Short of room, the ⎿ lines go, so more running agents fit; one that
  // waits on its person keeps its line.
  const asking = askingOf(view.at, agent)
  const call = callOf(agent, asking, width)
  if (call !== undefined && (!isTight || asking !== undefined)) {
    lines.push(call)
  }
  const isOpen = !node.isMain && open.includes(`agent:${agent.id}`)
  const task = isOpen
    ? clip(
        agent.task.split('\n').flatMap(paragraph => wrap(paragraph, width)),
        TASK_LINES,
      )
    : []

  return { under, status: lines, task: isOpen && task.length === 0 ? ['No task text.'] : task }
}

// What leads the lines under an agent's row: its stem, carrying on down to
// its children when it has any.
export function underOf(node: AgentNode): string {
  return `${node.stem}${node.hasChildren ? '│  ' : '   '}`
}

// What comes before an agent's title: its branch, its toggle, its mark.
export function leadOf(node: AgentNode): number {
  return cells(node.branch) + (node.isMain ? 0 : 2) + 2
}

// Its time, its tool calls and its context: "45k tokens", and for the main
// conversation "74% context", while there is room for the words beside a
// title of MIN_TITLE cells (or on a line of its own on a narrow pane);
// "45k tok" and "74%" when there isn't.
export function tallyOf(view: View, node: AgentNode): string {
  const words = agentTally(view, node.agent, true)
  const room = view.columns < NARROW ? view.columns - cells(underOf(node)) : view.columns - leadOf(node) - MIN_TITLE - 1

  return cells(words) <= room ? words : agentTally(view, node.agent, false)
}

export function agentTally(view: View, agent: Agent, isInWords: boolean): string {
  const time = agent.endedAt === undefined ? minutes(view.at - agent.startedAt) : duration(agent.endedAt - agent.startedAt)
  const parts = [time, `${agent.tools} ${agent.tools === 1 ? 'tool' : 'tools'}`]
  if (agent.tokens !== undefined) {
    parts.push(`${tokenNumber(agent.tokens)} ${isInWords ? 'tokens' : 'tok'}`)
  }
  if (agent.percent !== undefined) {
    parts.push(isInWords ? `${Math.round(agent.percent)}% context` : `${Math.round(agent.percent)}%`)
  }

  return parts.join(' · ')
}

export function nodeRows(view: View, node: AgentNode, open: readonly string[], isTight: boolean): number {
  const { status, task } = agentLines(view, node, open, isTight)

  return 1 + status.length + task.length
}

// The agents in `room` rows. Past the room, finished agents with nothing
// under them go first, oldest first; then the rest are counted on one line.
// After x on an agent, the question whether to stop it, under its row.
export type AgentStop = { asked: string | null; answer: (isYes: boolean) => void }

export function agentSection(view: View, main: Agent | undefined, team: Agent[], open: readonly string[], room: number, stop: AgentStop) {
  const { Box, Button, Text } = view.ui
  const isNarrow = view.columns < NARROW
  let shown = shownAgents(team)
  let nodes = agentTree(main, shown)
  let isTight = false
  const isAsked = (a: Agent) => stop.asked === `agent:${a.id}`
  const rowsOf = (all: AgentNode[]) => all.reduce((sum, node) => sum + nodeRows(view, node, open, isTight) + (isAsked(node.agent) ? 1 : 0), 0)
  // The rows for `count` agents of the `total` on show: the heading takes
  // one, and once an agent is left out, so does "+N more".
  const total = nodes.length
  const limit = (count: number) => room - 1 - (count < total ? 1 : 0)

  // Short of room: finished agents with nothing under them go first, oldest
  // first; then the ⎿ lines; only then running agents.
  while (rowsOf(nodes) > limit(nodes.length)) {
    const leaves = nodes.filter(node => !node.isMain && node.agent.state !== 'running' && !node.hasChildren)
    const oldest = leaves.toSorted((a, b) => (a.agent.endedAt ?? 0) - (b.agent.endedAt ?? 0))[0]
    if (oldest === undefined) {
      break
    }
    shown = shown.filter(a => a.id !== oldest.agent.id)
    nodes = agentTree(main, shown)
  }
  isTight = rowsOf(nodes) > limit(nodes.length)

  let kept = nodes
  if (rowsOf(kept) > limit(kept.length)) {
    kept = []
    for (const node of nodes) {
      if (rowsOf([...kept, node]) > limit(kept.length + 1)) {
        break
      }
      kept.push(node)
    }
  }
  const hidden = total - kept.length
  const running = (main?.state === 'running' ? 1 : 0) + team.filter(a => a.state === 'running').length
  const waiting = team.filter(a => askingOf(view.at, a) !== undefined).length
  const count = [running > 0 ? `${running} running` : '', waiting > 0 ? `${waiting} waiting` : ''].filter(part => part !== '').join(' · ')

  return {
    rows: 1 + Math.max(1, rowsOf(kept) + (hidden > 0 ? 1 : 0)),
    toggles: kept.flatMap(node => (node.isMain ? [] : [{ key: `toggle-agent-${node.agent.id}`, target: `agent:${node.agent.id}` }])),
    node: (
      <Box flexDirection="column">
        {heading(view, 'agents-heading', 'Agents', count)}
        {kept.length === 0 && hidden === 0 && (
          <Box key="no-agents">
            <Text dimColor>No agents running.</Text>
          </Box>
        )}
        {kept.map(node => {
          const { agent: a, branch, isMain } = node
          const { under, status, task } = agentLines(view, node, open, isTight)
          const isRunning = a.state === 'running'
          const { mark, color } = agentMark(view, a)
          const tally = tallyOf(view, node)
          const title = fit(`${a.type} ${a.description}`, view.columns - leadOf(node) - (isNarrow ? 0 : cells(tally) + 1))
          const type = title.startsWith(a.type) ? a.type : title

          return (
            <Box key={`agent-${a.id}`} flexDirection="column">
              <Box flexDirection="row">
                {branch !== '' && <Text dimColor>{branch}</Text>}
                {!isMain && (
                  <Button key={`toggle-agent-${a.id}`} plain label={task.length > 0 ? '▾' : '▸'} onPress={() => view.toggle(`agent:${a.id}`)} />
                )}
                {!isMain && <Text> </Text>}
                <Box flexGrow={1}>
                  <Text dimColor={!isRunning}>
                    <Text color={color}>{mark}</Text>{' '}
                    <Text inverse={view.cursor === `toggle-agent-${a.id}`}>
                      <Text bold>{type}</Text>
                      {title.slice(type.length)}
                    </Text>
                  </Text>
                </Box>
                {!isNarrow && <Text dimColor> {tally}</Text>}
              </Box>
              {isAsked(a) && (
                <Box key={`stop-agent-${a.id}`} flexDirection="row" columnGap={2} paddingLeft={4}>
                  <Text color="warning">{fit(`Stop ${a.type} ${a.description}?`, view.columns - 20)}</Text>
                  <Button key="stop-yes" plain hotkey="y" label="yes" onPress={() => stop.answer(true)} />
                  <Button key="stop-no" plain hotkey="n" label="no" onPress={() => stop.answer(false)} />
                </Box>
              )}
              {status.map(line => (
                <Text dimColor>
                  {under}
                  {line}
                </Text>
              ))}
              {task.length > 0 && (
                <Box key={`task-${a.id}`} flexDirection="column">
                  {task.map(line => (
                    <Text dimColor>
                      {under}
                      {line}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}
        {hidden > 0 && (
          <Box key="more-agents">
            <Text dimColor>+{hidden} more</Text>
          </Box>
        )}
      </Box>
    ),
  }
}
