// glimt's hooks, and everything that talks to the engine: the engine follows
// $ only into functions of this file, and reads state only through atoms
// declared here, so all of that lives here. The other modules are pure: what
// the pane computes and draws.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'
import type { Activity, Agent, AgentState, Composer, Feed, Opened, Plan, RemoteAgent, RemoteList, Session, Shared, SharedAgent, Step } from '../types'
import { agentSection, contextTokens, isTurnRunning, mainAgent } from './agents'
import type { Spawned } from './agents'
import { FEED_KEPT, TAIL_BYTES, callLine, drillSection, isShownText, parseTranscript } from './drill'
import { FORM_ROWS, composerSection, helpSection, keySection, selfSection } from './keys'
import { applyUpdate, nowSection, parentFrom, planLines, planSection, planTitle, planUnits, rowCount } from './plan'
import type { StepUpdate } from './plan'
import { HEARTBEAT_MS, REMOTE_KEPT, SHARED_TASK, STALE_MS, isReachable, isSessionBusy, isShared, parseSessions, sessionSection, sortSessions } from './sessions'
import { PANE, runtime } from './state'
import type { Toggle } from './state'
import { FRAME_MS, describeCall, fit, spin, wrap } from './text'
import type { View } from './view'

// Who counts as asking: the person, typing or through Remote Control or the
// SDK. A task notification, a peer or a plugin is not a new request.
const PERSON: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge', 'sdk'])

// The shares of a docked pane's rows the agents and the other sessions may
// take from the plan, which gets the rest.
const AGENT_SHARE = 0.35
const SESSION_SHARE = 0.25

// How often the session list is read again while the pane is drawn, and how
// often this session shares its running agents (when they changed) and
// looks for a name another session's glimt asked it to take.
const POLL_MS = 5000

// Drilled into another session, its transcript is read again this often,
// from its last TAIL_BYTES; an agent of this session is read as it acts.
// The newest FEED_KEPT items are kept.
const FEED_MS = 2000
// Rows the chat leaves out while the pane shows them.
const PLAN_TOOLS: ReadonlySet<string> = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

// One line in the system prompt, sent while the task tools are on offer, so
// Claude files a sub-step under its step.
const SUB_STEP_NOTE =
  "When a task you create with TaskCreate is a sub-step of another task, set metadata.parent to that task's id."

const focus = atom({ plugin: 'glimt', key: 'focus' } as const, null)
const plan = atom({ plugin: 'glimt', key: 'plan' } as const, null)
const steps = atom({ plugin: 'glimt', key: 'steps' } as const, [])
const agents = atom({ plugin: 'glimt', key: 'agents' } as const, [])
const now = atom({ plugin: 'glimt', key: 'now' } as const, 0)
const isShown = atom({ plugin: 'glimt', key: 'isShown' } as const, false)
const expanded = atom({ plugin: 'glimt', key: 'expanded' } as const, [])
const cursor = atom({ plugin: 'glimt', key: 'cursor' } as const, null)
const sessions = atom({ plugin: 'glimt', key: 'sessions' } as const, null)
const sessionsError = atom({ plugin: 'glimt', key: 'sessionsError' } as const, null)
const stopping = atom({ plugin: 'glimt', key: 'stopping' } as const, null)
const self = atom({ plugin: 'glimt', key: 'self' } as const, null)
const shared = atom({ plugin: 'glimt', key: 'shared' } as const, {})
const composer = atom({ plugin: 'glimt', key: 'composer' } as const, null)
const clearing = atom({ plugin: 'glimt', key: 'clearing' } as const, false)
const opened = atom({ plugin: 'glimt', key: 'opened' } as const, [])
const feed = atom({ plugin: 'glimt', key: 'feed' } as const, null)
const remote = atom({ plugin: 'glimt', key: 'remote' } as const, {})
const remoteTasks = atom({ plugin: 'glimt', key: 'remoteTasks' } as const, {})
const help = atom({ plugin: 'glimt', key: 'help' } as const, false)

const transcripts = new Map<string, string>()

// Each subagent's type and description, by its meta file: they never change.
const metas = new Map<string, { type: string; description: string }>()

export const register: Register = on => {
  // The command last: a refused registration then leaves the pane and its clock running.
  on('session.start', async ($, e, next) => {
    $.clock.every(FRAME_MS, () => void tick($))
    $.clock.every(POLL_MS, () => void readSessions($, false).catch(() => undefined))
    $.clock.every(POLL_MS, () => void share($).catch(() => undefined))
    $.clock.every(FEED_MS, () => void readFeed($, true).catch(() => undefined))
    $.clock.every(POLL_MS, () => void readRemote($).catch(() => undefined))
    void openPane($).catch(() => undefined)
    runtime.home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    runtime.configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${runtime.home}/.claude`
    await learnSelf($)
    void readSessions($, true).catch(() => undefined)
    await seedSteps($).catch(() => undefined)
    await $.command.register({
      name: 'glimt',
      description: 'Open the glimt pane: what is in progress, the plan, the agents, and the other sessions',
    })

    return next(e)
  })

  // /clear, /resume and /branch put every $.state value back to its default
  // and raise no session.start: learn the session's id again, and whether
  // the pane is drawn.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await learnSelf($)
    void openPane($).catch(() => undefined)
    void readSessions($, true).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'glimt' }, async $ => {
    await openPane($, true)

    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isShown, () => false)
    }

    return next(e)
  })

  // Tab and the arrows move Claude Code's focus ring; the cursor follows it
  // onto a toggle. Leaving the form's field that way, or by a click, closes
  // the form.
  on('ui.focus', async ($, e, next) => {
    const key = e.element
    if (e.requestId === PANE && key !== undefined && runtime.toggles.some(one => one.key === key)) {
      await update($, cursor, () => key)
    }
    if (e.requestId === PANE && e.origin.kind === 'person' && key !== 'composer-field' && (await read($, composer)) !== null) {
      await update($, composer, () => null)
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes('TaskCreate')) {
      return composed
    }

    return { sections: [...composed.sections, { id: 'glimt:sub-steps', text: SUB_STEP_NOTE, scope: 'session' as const }] }
  })

  // While the pane is drawn the chat leaves out the plan's rows and squeezes a
  // running agent to one line; an errored call still shows.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const isPlanRow = PLAN_TOOLS.has(e.props.tool)
    const isLiveAgent = e.props.tool === 'Agent' && e.props.isRunning
    if ((!isPlanRow && !isLiveAgent) || e.props.isErrored || !(await read($, isShown))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    if (isPlanRow) {
      return <Box />
    }

    const input = (typeof e.props.input === 'object' && e.props.input !== null ? e.props.input : {}) as Record<string, unknown>
    const type = typeof input.subagent_type === 'string' ? input.subagent_type : 'Agent'
    const description = typeof input.description === 'string' ? input.description : ''

    return (
      <Text dimColor wrap="truncate-end">
        {spin(await read($, now))} {type} · {description}
      </Text>
    )
  })

  // A /clear starts a new conversation: nothing on show belongs to it.
  on('session.end', async ($, e, next) => {
    // The session's share goes with it; after a /clear the next is under a new id.
    const id = await read($, self)
    if (id !== null) {
      await $.store.delete(`agents:${id}`).catch(() => undefined)
    }
    runtime.lastShared = ''
    if (e.reason === 'clear') {
      await update($, focus, () => null)
      await update($, plan, () => null)
      await update($, steps, () => [])
      await update($, agents, () => [])
      await update($, expanded, () => [])
      await update($, cursor, () => null)
      await update($, stopping, () => null)
      await update($, opened, () => [])
      await update($, feed, () => null)
      await update($, help, () => false)
    }

    return next(e)
  })

  // A new request from the person clears the agents that finished before it.
  on('prompt.submit', async ($, e, next) => {
    if (PERSON.has(e.origin.kind) && !e.text.startsWith('/')) {
      await update($, agents, list => list.filter(a => a.state === 'running'))
    }

    return next(e)
  })

  // The main loop's turns: a subagent's run raises no turn.start.
  on('turn.start', async ($, e, next) => {
    runtime.isBusy = true
    const at = await $.clock.now()
    await update($, focus, () => ({ startedAt: at, tools: 0 }))
    await update($, now, () => at)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    const agentId = e.agentId
    const state: AgentState = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
    if (agentId === undefined) {
      await update($, focus, f =>
        f === null ? f : { ...f, endedAt: at, outcome: state, tool: undefined, doing: undefined },
      )
    } else {
      await update($, agents, list =>
        list.map(a => (a.agentId === agentId ? { ...a, state, endedAt: at, tool: undefined, doing: undefined } : a)),
      )
      await readAgentFeed($, agentId).catch(() => undefined)
    }
    await update($, now, () => at)

    return next(e)
  })

  // An agent's own tasks nest under the plan step in progress when it
  // started; one spawned by another agent nests where that agent does.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) {
      return started
    }

    await recordAgent($, {
      agentId: started.agentId,
      fallbackId: e.tool_use_id,
      parentId: e.parentAgentId,
      type: e.subagentType,
      description: e.description,
      task: e.prompt,
    })

    return started
  })

  // Each model request of any loop: the size of that loop's context, and for
  // the main conversation how full its window is.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result.usage !== null) {
      const tokens = contextTokens(result.usage)
      const agentId = e.agentId
      if (agentId === undefined) {
        const percent = (await $.session.usage().catch(() => undefined))?.context.percent
        await update($, focus, f => (f === null ? f : { ...f, tokens, percent }))
      } else {
        await update($, agents, list => list.map(a => (a.agentId === agentId ? { ...a, tokens } : a)))
      }
    }
    if (e.agentId !== undefined) {
      await readAgentFeed($, e.agentId).catch(() => undefined)
    }

    return result
  })

  // Each loop's calls: the tool it runs now and how many it has made. The
  // pane's own calls (TaskList, TaskGet) never pass its own hooks.
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    const tool = String(e.tool)
    const doing = describeCall(e)
    if (agentId === undefined) {
      await update($, focus, f =>
        f === null || !isTurnRunning(f) ? f : { ...f, tools: (f.tools ?? 0) + 1, tool, doing },
      )
      try {
        return await next(e)
      } finally {
        await update($, focus, f => (f !== null && f.tool === tool ? { ...f, tool: undefined, doing: undefined } : f))
      }
    }

    runtime.isBusy = true
    await update($, agents, list =>
      list.map(a =>
        a.agentId === agentId ? { ...a, state: 'running', endedAt: undefined, tools: a.tools + 1, tool, doing } : a,
      ),
    )
    await readAgentFeed($, agentId).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      await update($, agents, list =>
        list.map(a => (a.agentId === agentId && a.tool === tool ? { ...a, tool: undefined, doing: undefined } : a)),
      )
      await readAgentFeed($, agentId).catch(() => undefined)
    }
  })

  // The plan is the main loop's task list: TaskCreate and TaskUpdate, or
  // TodoWrite where a build still uses it. A subagent's own tasks join it as
  // sub-steps (see ownerOf).
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const owner = await ownerOf($, e.agentId)
    if (ran.deny !== undefined || ran.isError || owner === null) {
      return ran
    }

    const { id, subject } = ran.result.task
    const parent = parentFrom(e.metadata)
    const step: Step = {
      id: owner.prefix + id,
      subject,
      description: e.description,
      activeForm: e.activeForm,
      status: 'pending',
      parentId: typeof parent === 'string' ? owner.prefix + parent : owner.stepId,
    }
    await update($, steps, list => [...list, step])

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const owner = await ownerOf($, e.agentId)
    if (ran.deny !== undefined || ran.isError || !ran.result.success || owner === null) {
      return ran
    }

    const parent = parentFrom(e.metadata)
    const change: StepUpdate = {
      taskId: owner.prefix + e.taskId,
      subject: e.subject,
      description: e.description,
      activeForm: e.activeForm,
      status: e.status,
      parent: typeof parent === 'string' ? owner.prefix + parent : parent,
    }
    const at = await $.clock.now()
    // A subagent's task the pane never saw made is none of the plan's.
    await update($, steps, list =>
      owner.prefix !== '' && !list.some(step => step.id === change.taskId) ? list : applyUpdate(list, change, at),
    )

    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError) {
      const todos = ran.result.newTodos
      const at = await $.clock.now()
      // TodoWrite sends the whole list each time: a todo still in progress
      // under the same words keeps the time it started.
      await update($, steps, list =>
        todos.map((todo, i) => {
          const before = list.find(step => step.subject === todo.content && step.status === 'in_progress')
          return {
            id: String(i + 1),
            subject: todo.content,
            description: '',
            activeForm: todo.activeForm,
            status: todo.status,
            startedAt: todo.status === 'in_progress' ? (before?.startedAt ?? at) : undefined,
          }
        }),
      )
    }

    return ran
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError && ran.result.plan) {
      const approved: Plan = { title: planTitle(ran.result.plan), path: ran.result.filePath }
      await update($, plan, () => approved)
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const request = await read($, focus)
    const approved = await read($, plan)
    const list = await read($, steps)
    const team = await read($, agents)
    const open = await read($, expanded)
    const view: View = {
      ui,
      Input: 'Input' in ui ? ui.Input : undefined,
      columns: Math.max(12, e.props.bodyColumns),
      at: await read($, now),
      isTurnRunning: isTurnRunning(request),
      cursor: await read($, cursor),
      toggle: key => void toggle($, key),
    }

    // This session at the top; the other sessions on the machine, and what
    // their glimts share, at the bottom.
    const listed = await read($, sessions)
    const selfId = await read($, self)
    const others = listed === null ? null : sortSessions(listed.filter(s => s.sessionId !== selfId))
    const sharedBy = await read($, shared)
    const pointed = others?.find(s => view.cursor === `toggle-session-${s.sessionId}`)
    const isOnSelf = view.cursor === 'toggle-self'
    const renameTarget = isOnSelf ? selfId : pointed !== undefined && sharedBy[pointed.sessionId] !== undefined ? pointed.sessionId : null
    const keys = e.props.isFocused
      ? keySection(
          view,
          {
            canOpen: view.cursor !== null,
            canClear: isOnSelf,
            canRename: renameTarget !== null,
            canReach: pointed !== undefined && isReachable(pointed),
          },
          {
            down: () => void move($, 1),
            up: () => void move($, -1),
            into: () => void goInto($),
            back: () => void goBack($),
            open: () => void openFocused($),
            spawn: () => void openComposer($, { kind: 'spawn', where: 'here' }),
            help: () => void update($, help, () => true),
            rename: () => void (renameTarget === null ? undefined : openComposer($, { kind: 'rename', sessionId: renameTarget })),
            clear: () => void update($, clearing, () => true),
            attach: () => void attachSession($),
            stop: () => void askStop($),
          },
        )
      : undefined

    const header = selfSection(view, {
      session: listed?.find(s => s.sessionId === selfId),
      isOpen: open.includes('self'),
      isClearing: await read($, clearing),
      answer: isYes => void answerClear($, isYes),
    })
    // Esc in the form's field hands the keyboard back to the prompt and raises
    // nothing else: drawn without the keyboard, the form shows no more, and
    // the clock's next frame closes it (a drawing may not write).
    runtime.isFocused = e.props.isFocused
    const form = e.props.isFocused ? await read($, composer) : null
    const formRows = form === null ? 0 : FORM_ROWS
    const formNode =
      form === null
        ? undefined
        : composerSection(view, form, listed ?? [], {
            spawn: (task, where) => void spawnAgent($, task, where),
            rename: (sessionId, name) => void renameSession($, sessionId, name),
            cancel: () => void update($, composer, () => null),
          })

    // The sections stack from the top, each in a place that never moves: this
    // session, any open form, what is in progress, the plan, the agents, the
    // other sessions, and the keys while the pane holds the keyboard. Docked,
    // the pane's height is a budget: the agents and the sessions take up to
    // their shares and the plan, the longest list, gets what is left and
    // folds to fit. Inline, nothing is cut.
    const rows = e.props.placement === 'dock' ? e.props.scroll.bodyRows : undefined

    // i: the key list takes the pane until i again, or a key it lists.
    if (await read($, help)) {
      runtime.toggles = []
      const leave = async (then: () => Promise<unknown>) => {
        await update($, help, () => false)
        await then()
      }
      return (
        <Box flexDirection="column" width={view.columns}>
          {helpSection(view, {
            spawn: () => void leave(() => openComposer($, { kind: 'spawn', where: 'here' })),
            session: () => void leave(() => openComposer($, { kind: 'spawn', where: 'session' })),
            close: () => void leave(() => $.ui.close({ id: PANE })),
            back: () => void update($, help, () => false),
          })}
        </Box>
      )
    }

    // Gone into an agent or a session, it takes the pane: j and k walk a
    // session's agents, and h steps back out to where it was.
    const into = (await read($, opened)).at(-1)
    const remoteBy = await read($, remote)
    const tasks = await read($, remoteTasks)
    if (into !== undefined) {
      const sessionId = into.kind === 'agent' ? undefined : into.sessionId
      const drill = drillSection(view, {
        into,
        agent: into.kind === 'agent' ? team.find(a => a.id === into.id) : undefined,
        session: sessionId === undefined ? undefined : listed?.find(s => s.sessionId === sessionId),
        remoteAgent: into.kind === 'remote' ? remoteBy[into.sessionId]?.agents.find(a => a.id === into.agentId) : undefined,
        remote: sessionId === undefined ? undefined : remoteBy[sessionId],
        shared: sessionId === undefined ? [] : (sharedBy[sessionId]?.agents ?? []),
        isSharing: sessionId !== undefined && sharedBy[sessionId] !== undefined,
        tasks,
        open,
        feed: await read($, feed),
        asked: await read($, stopping),
        isFocused: e.props.isFocused && formNode === undefined,
        room: rows === undefined ? undefined : rows - formRows,
        act: {
          back: () => void goBack($),
          into: () => void goInto($),
          down: () => void move($, 1),
          up: () => void move($, -1),
          open: () => void openFocused($),
          message: () => void $.ui.focus({ requestId: PANE, key: 'message-field' }).catch(() => undefined),
          send: (to, name, text) => void sendFromField($, to, name, text),
          rename: () => void (into.kind === 'session' ? openComposer($, { kind: 'rename', sessionId: into.sessionId }) : undefined),
          attach: () => void attachSession($),
          stop: () => void askStop($),
          answer: isYes => void answerStop($, isYes),
          help: () => void update($, help, () => true),
        },
      })
      runtime.toggles = drill.toggles
      return (
        <Box flexDirection="column" width={view.columns}>
          {drill.node}
          {formNode !== undefined && (
            <Box flexDirection="column" marginTop={1}>
              {formNode}
            </Box>
          )}
        </Box>
      )
    }

    // Before anything has happened, one quiet line says what will show here.
    const isEmpty =
      list.length === 0 &&
      team.length === 0 &&
      request?.startedAt === undefined &&
      others?.length === 0 &&
      (await read($, sessionsError)) === null
    if (isEmpty) {
      runtime.toggles = [{ key: 'toggle-self', target: 'self' }]
      const footer = formNode ?? keys?.node
      return (
        <Box flexDirection="column" width={view.columns} height={rows}>
          {header.node}
          <Box key="empty" flexDirection="column" marginTop={1}>
            {wrap('glimt · the plan, agents and other sessions show here as they start', view.columns).map(text => (
              <Text dimColor>{text}</Text>
            ))}
          </Box>
          <Box key="gap" flexGrow={1} />
          {footer !== undefined && (
            <Box flexDirection="column" marginTop={1}>
              {footer}
            </Box>
          )}
        </Box>
      )
    }

    const share = (part: number) => (rows === undefined ? Infinity : Math.max(3, Math.floor(rows * part)))
    const current = nowSection(view, list)
    const units = planUnits(list, open, view.columns)
    // The footer: the form while one is open, else the keys while they show.
    const footerRows = formNode !== undefined ? formRows : keys === undefined ? 0 : 1 + keys.rows
    // Rows the plan does not need go to the agents, then the sessions, before
    // either folds: the pane less this session's rows, the plan's heading and
    // its lines unfolded, both shares, a blank row above each section, and
    // the footer.
    const spare =
      rows === undefined
        ? 0
        : Math.max(
            0,
            rows - header.rows - current.rows - 1 - Math.max(1, rowCount(units.flat())) - share(AGENT_SHARE) - share(SESSION_SHARE) - 4 - footerRows,
          )
    const crew = agentSection(view, mainAgent(request), team, open, share(AGENT_SHARE) + spare)
    const listing = sessionSection(
      view,
      {
        list: others,
        error: await read($, sessionsError),
        shared: sharedBy,
        remote: remoteBy,
        tasks,
        open,
        asked: await read($, stopping),
        answer: isYes => void answerStop($, isYes),
      },
      share(SESSION_SHARE) + spare - Math.max(0, crew.rows - share(AGENT_SHARE)),
    )
    // Left for the plan: less this session's rows, its own heading, the blank
    // row above each section, and the footer.
    const planRoom =
      rows === undefined ? Infinity : Math.max(1, rows - header.rows - 1 - current.rows - crew.rows - listing.rows - 4 - footerRows)
    const lines = planLines(units, planRoom)
    runtime.toggles = [
      { key: 'toggle-self', target: 'self' },
      ...lines.flatMap(line => (line.kind === 'step' ? [{ key: `toggle-${line.step.id}`, target: line.step.id }] : [])),
      ...crew.toggles,
      ...listing.toggles,
    ]

    // Docked, the sessions and the footer keep to the bottom: agents coming
    // and going change the gap above them, never where they stand.
    const footer = formNode ?? keys?.node
    return (
      <Box flexDirection="column" width={view.columns} height={rows}>
        {header.node}
        <Box flexDirection="column" marginTop={1}>
          {current.node}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {planSection(view, approved, list, lines)}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {crew.node}
        </Box>
        <Box key="gap" flexGrow={1} />
        <Box flexDirection="column" marginTop={1}>
          {listing.node}
        </Box>
        {footer !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            {footer}
          </Box>
        )}
      </Box>
    )
  })
}

// Opened unasked, at session start, the pane waits for a wide terminal and
// leaves the keyboard alone; opened by /glimt it takes the keyboard.
async function openPane($: EngineInterface, isAsked = false) {
  const pane = { id: PANE, title: 'glimt' }
  const opened = await $.ui.open(isAsked ? { ...pane, focus: true as const } : pane)
  await update($, isShown, () => opened.isPlaced)
}

// A resumed session already holds a task list: read it once, so the plan
// shows before it next changes.
async function seedSteps($: EngineInterface) {
  const listed = await $.tool.call({ tool: 'TaskList' })
  if (listed.deny !== undefined || listed.isError) {
    return
  }

  const tasks = listed.result.tasks
  await update($, steps, list =>
    list.length > 0 ? list : tasks.map(task => ({ id: task.id, subject: task.subject, status: task.status })),
  )
}

// Whose task list a call changes. The main loop's is the plan itself. A
// subagent's joins it under the step its run belongs to, its ids led by the
// agent's so they never meet the main list's; a subagent started while no
// step was in progress keeps its tasks to itself (null).
async function ownerOf($: EngineInterface, agentId: string | undefined): Promise<{ prefix: string; stepId?: string } | null> {
  if (agentId === undefined) {
    return { prefix: '' }
  }

  const agent = (await read($, agents)).find(a => a.agentId === agentId)

  return agent?.stepId === undefined ? null : { prefix: `${agentId}/`, stepId: agent.stepId }
}

// Opens or closes a step (keyed by its task id) or an agent ("agent:" and its
// id). A step seeded from TaskList has no description yet: the first
// opening reads it with TaskGet.
async function toggle($: EngineInterface, id: string) {
  const open = await update($, expanded, ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
  // Another session shows its agents as it opens; one of them, its task.
  const [kind = '', sessionId = '', agentId = ''] = id.split(':')
  if (open.includes(id) && kind === 'session') {
    await readRemote($, [sessionId]).catch(() => undefined)
  }
  if (open.includes(id) && kind === 'remote') {
    await loadRemoteTask($, sessionId, agentId).catch(() => undefined)
  }
  const step = (await read($, steps)).find(one => one.id === id)
  if (!open.includes(id) || step === undefined || step.description !== undefined) {
    return
  }

  const got = await $.tool.call({ tool: 'TaskGet', taskId: id }).catch(() => undefined)
  const task = got === undefined || got.deny !== undefined || got.isError ? null : got.result.task
  const description = task?.description ?? ''
  await update($, steps, list => list.map(one => (one.id === id ? { ...one, description } : one)))
}

// j and k: the cursor to the next or the previous toggle, from the first or
// the last when it is on none of them; past either end it stays. Claude
// Code's focus ring is asked to follow, so Enter presses the same toggle;
// where it can't, the cursor still stands.
async function move($: EngineInterface, by: 1 | -1) {
  const current = await read($, cursor)
  const at = runtime.toggles.findIndex(one => one.key === current)
  await point($, runtime.toggles[at === -1 ? (by === 1 ? 0 : runtime.toggles.length - 1) : at + by])
}

// l: one step in, as Claude Code's agent view goes into a session: from the
// overview into one of this session's agents, another session or one of its
// agents; from a session, into one of its agents. The pane shows it alone,
// its activity read at once. On a step or on this session, l opens the row.
async function goInto($: EngineInterface) {
  const key = await read($, cursor)
  const target = runtime.toggles.find(one => one.key === key)?.target
  if (target === undefined) {
    return
  }

  const [kind = '', id = '', agentId = ''] = target.split(':')
  const from = key ?? undefined
  const step: Opened | null =
    kind === 'agent'
      ? { kind: 'agent', id: target.slice('agent:'.length), from }
      : kind === 'session'
        ? { kind: 'session', sessionId: id, from }
        : kind === 'remote'
          ? { kind: 'remote', sessionId: id, agentId, from }
          : null
  if (step === null) {
    if (!(await read($, expanded)).includes(target)) {
      await toggle($, target)
    }
    return
  }

  await update($, feed, () => null)
  await update($, opened, trail => [...trail, step])
  if (step.kind === 'session') {
    await readRemote($, [step.sessionId]).catch(() => undefined)
  }
  if (step.kind === 'remote') {
    await loadRemoteTask($, step.sessionId, step.agentId).catch(() => undefined)
  }
  await readFeed($).catch(() => undefined)
}

// h: one step back out, the cursor on the row it went in from; in the
// overview, closes the row the cursor is on.
async function goBack($: EngineInterface) {
  const last = (await read($, opened)).at(-1)
  if (last !== undefined) {
    await update($, opened, trail => trail.slice(0, -1))
    await update($, feed, () => null)
    await update($, cursor, () => last.from ?? null)
    if (last.from !== undefined) {
      await $.ui.focus({ requestId: PANE, key: last.from }).catch(() => undefined)
    }
    await readFeed($).catch(() => undefined)
    return
  }

  const key = await read($, cursor)
  const target = runtime.toggles.find(one => one.key === key)?.target
  if (target !== undefined && (await read($, expanded)).includes(target)) {
    await toggle($, target)
  }
}

// The activity of the step the pane shows: one of this session's agents'
// messages as the session holds them, another session's or its agent's
// from the tail of its transcript. The timer reads only those on disk. A
// read that a move overtook is dropped.
async function readFeed($: EngineInterface, isTimer = false) {
  const top = (await read($, opened)).at(-1)
  if (top === undefined || (isTimer && top.kind === 'agent')) {
    return
  }

  const reading =
    top.kind === 'agent' ? agentFeed($, top.id) : top.kind === 'session' ? sessionFeed($, top.sessionId) : remoteFeed($, top.sessionId, top.agentId)
  const got = await reading.catch((error: unknown): Feed => ({ items: [], error: error instanceof Error ? error.message : String(error) }))
  const still = (await read($, opened)).at(-1)
  if (still !== undefined && JSON.stringify(still) === JSON.stringify(top)) {
    await update($, feed, () => ({ ...got, items: got.items.slice(-FEED_KEPT) }))
  }
}

// After an agent of this session acts: its activity again, when the pane
// shows it.
async function readAgentFeed($: EngineInterface, agentId: string) {
  const top = (await read($, opened)).at(-1)
  if (top?.kind !== 'agent') {
    return
  }

  const agent = (await read($, agents)).find(a => a.id === top.id)
  if (agent?.agentId === agentId) {
    await readFeed($)
  }
}

async function agentFeed($: EngineInterface, id: string): Promise<Feed> {
  const agent = (await read($, agents)).find(a => a.id === id)
  if (agent?.agentId === undefined) {
    return { items: [], error: 'This agent has no transcript to read.' }
  }

  const found = await $.session.messages({ agentId: agent.agentId })
  if ('deny' in found) {
    return { items: [], error: found.deny }
  }

  // Its first message is the task, drawn above the activity already.
  return {
    items: found.flatMap((message): Activity[] => [
      ...(isShownText(message.text) && !(message.role === 'user' && message.text.trim() === agent.task.trim())
        ? [{ kind: message.role === 'user' ? ('asked' as const) : ('said' as const), text: message.text.trim() }]
        : []),
      ...message.toolUses.map(use => ({ kind: 'call' as const, text: callLine(use.tool, use.input) })),
    ]),
  }
}

async function sessionFeed($: EngineInterface, sessionId: string): Promise<Feed> {
  const s = (await read($, sessions))?.find(one => one.sessionId === sessionId)
  const path = s === undefined ? null : await transcriptOf($, s)
  if (path === null) {
    return { items: [], error: 'No transcript found for this session.' }
  }

  return tailFeed($, path, false)
}

// Another session's agent: the tail of its own transcript, less its task.
async function remoteFeed($: EngineInterface, sessionId: string, agentId: string): Promise<Feed> {
  const s = (await read($, sessions))?.find(one => one.sessionId === sessionId)
  const dir = s === undefined ? null : await subagentsDir($, s)
  if (dir === null) {
    return { items: [], error: 'No transcript found for this agent.' }
  }

  const got = await tailFeed($, `${dir}/agent-${agentId}.jsonl`, true)
  const task = (await read($, remoteTasks))[`${sessionId}:${agentId}`]
  return { ...got, items: got.items.filter(item => !(item.kind === 'asked' && item.text === task)) }
}

async function tailFeed($: EngineInterface, path: string, isSubagent: boolean): Promise<Feed> {
  const ran = await $.process.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 5000 })
  if (ran.exitCode !== 0) {
    return { items: [], error: ran.stderr.trim().split('\n')[0] || 'Could not read the transcript.' }
  }

  return { items: parseTranscript(ran.stdout, isSubagent) }
}

// The subagents of the sessions opened in the list or drilled into: every
// POLL_MS while the pane is drawn, and at once when one opens.
async function readRemote($: EngineInterface, only?: string[]) {
  if (only === undefined && !(await read($, isShown))) {
    return
  }

  const listed = (await read($, sessions)) ?? []
  const open = await read($, expanded)
  const trail = await read($, opened)
  const ids = only ?? [
    ...new Set([
      ...open.flatMap(key => (key.startsWith('session:') ? [key.slice('session:'.length)] : [])),
      ...trail.flatMap(step => (step.kind === 'agent' ? [] : [step.sessionId])),
    ]),
  ]
  for (const id of ids) {
    const s = listed.find(one => one.sessionId === id)
    if (s !== undefined) {
      const list = await remoteAgentsOf($, s)
      await update($, remote, all => ({ ...all, [id]: list }))
    }
  }
}

// A session's subagents, from the folder beside its transcript: the newest
// written first, each with the type and description of its meta file.
async function remoteAgentsOf($: EngineInterface, s: Session): Promise<RemoteList> {
  const dir = await subagentsDir($, s)
  if (dir === null) {
    return { agents: [], total: 0 }
  }

  const files = (await $.fs.list(dir).catch(() => [])).flatMap(entry => {
    const id = /^agent-(.+)\.jsonl$/.exec(entry.name)?.[1]
    return entry.kind === 'file' && id !== undefined ? [{ id, writtenAt: entry.mtimeMs }] : []
  })
  const agents: RemoteAgent[] = []
  for (const file of [...files].sort((a, b) => b.writtenAt - a.writtenAt).slice(0, REMOTE_KEPT)) {
    agents.push({ ...file, ...(await metaOf($, `${dir}/agent-${file.id}.meta.json`)) })
  }

  return { agents, total: files.length }
}

async function subagentsDir($: EngineInterface, s: Session): Promise<string | null> {
  const path = await transcriptOf($, s)

  return path === null ? null : `${path.slice(0, -'.jsonl'.length)}/subagents`
}

async function metaOf($: EngineInterface, path: string): Promise<{ type: string; description: string }> {
  const known = metas.get(path)
  if (known !== undefined) {
    return known
  }

  const text = await $.fs.read(path).catch(() => undefined)
  let fields: Record<string, unknown> = {}
  try {
    const parsed: unknown = text === undefined ? undefined : JSON.parse(text)
    fields = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    // A meta file being written reads as none; the next read tries again.
  }
  const meta = {
    type: typeof fields.agentType === 'string' ? fields.agentType : 'Agent',
    description: typeof fields.description === 'string' ? fields.description : '',
  }
  if (typeof fields.agentType === 'string') {
    metas.set(path, meta)
  }

  return meta
}

// Another session's agent's task: what its transcript's first line asked,
// read once.
async function loadRemoteTask($: EngineInterface, sessionId: string, agentId: string) {
  const key = `${sessionId}:${agentId}`
  if ((await read($, remoteTasks))[key] !== undefined) {
    return
  }

  const s = (await read($, sessions))?.find(one => one.sessionId === sessionId)
  const dir = s === undefined ? null : await subagentsDir($, s)
  if (dir === null) {
    return
  }
  const ran = await $.process.run(['head', '-n', '1', `${dir}/agent-${agentId}.jsonl`], { timeoutMs: 5000 })
  if (ran.exitCode === 0) {
    const task = parseTranscript(ran.stdout, true).find(item => item.kind === 'asked')?.text ?? ''
    await update($, remoteTasks, all => ({ ...all, [key]: task }))
  }
}

// A session's transcript: in Claude Code's projects folder, under the folder
// it runs in with every character but a letter or a digit made a dash; where
// it started somewhere else, in whichever project folder holds it.
async function transcriptOf($: EngineInterface, s: Session): Promise<string | null> {
  const known = transcripts.get(s.sessionId)
  if (known !== undefined) {
    return known
  }

  const root = `${runtime.configDir}/projects`
  const file = `${s.sessionId}.jsonl`
  const exists = (path: string) => $.fs.exists(path).catch(() => false)
  const guess = `${root}/${s.cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${file}`
  let found = (await exists(guess)) ? guess : undefined
  if (found === undefined) {
    for (const entry of await $.fs.list(root).catch(() => [])) {
      const path = `${root}/${entry.name}/${file}`
      if (entry.kind === 'dir' && (await exists(path))) {
        found = path
        break
      }
    }
  }
  if (found === undefined) {
    return null
  }

  transcripts.set(s.sessionId, found)
  return found
}

async function point($: EngineInterface, target: Toggle | undefined) {
  if (target === undefined) {
    return
  }

  await update($, cursor, () => target.key)
  await $.ui.focus({ requestId: PANE, key: target.key }).catch(() => undefined)
}

// o: opens or closes what the cursor is on.
async function openFocused($: EngineInterface) {
  const key = await read($, cursor)
  const target = runtime.toggles.find(one => one.key === key)
  if (target !== undefined) {
    await toggle($, target.target)
  }
}

// Reads every session from `claude agents --json`: at session start, after a
// stop, and every POLL_MS while the pane is drawn.
async function readSessions($: EngineInterface, isAsked: boolean) {
  if (!isAsked && !(await read($, isShown))) {
    return
  }

  const ran = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 10_000 }).catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 0) {
    const why = ran?.stderr.trim().split('\n')[0] || 'Could not run claude agents --json'
    await update($, sessionsError, () => why)
    return
  }

  let list: Session[]
  try {
    list = parseSessions(JSON.parse(ran.stdout))
  } catch {
    await update($, sessionsError, () => 'claude agents --json printed something other than a list of sessions')
    return
  }
  // The clock may have stood still a while: ages count from now.
  const at = await $.clock.now()
  await update($, now, () => at)
  await update($, sessions, () => list)
  await update($, sessionsError, () => null)
  await loadShared($, list, at).catch(() => undefined)
}

// What the listed sessions' glimts share, fresh ones only. The shares of
// sessions no longer listed, and names asked of them, are cleared away;
// this session's own keys are never touched here.
async function loadShared($: EngineInterface, list: Session[], at: number) {
  const listed = new Set(list.map(s => s.sessionId))
  const selfId = await read($, self)
  const fresh: Record<string, Shared> = {}
  for (const key of await $.store.keys()) {
    const [kind = '', ...rest] = key.split(':')
    const id = rest.join(':')
    if ((kind !== 'agents' && kind !== 'rename') || id === selfId) {
      continue
    }
    if (!listed.has(id)) {
      await $.store.delete(key)
      continue
    }
    const value = kind === 'agents' ? await $.store.get(key) : undefined
    if (isShared(value) && at - value.at <= STALE_MS) {
      fresh[id] = value
    }
  }
  await update($, shared, () => fresh)
}

// The session's own id: at start, and again after /clear, /resume or /branch.
async function learnSelf($: EngineInterface) {
  const id = await $.session.id().catch(() => null)
  await update($, self, () => id)
}

// Every POLL_MS: this session's running agents into the store for the other
// sessions' glimts, when they changed or a heartbeat is due; and any name
// another session's glimt asked this one to take.
async function share($: EngineInterface) {
  const id = await read($, self)
  if (id === null) {
    return
  }

  const at = await $.clock.now()
  const running: SharedAgent[] = (await read($, agents))
    .filter(a => a.state === 'running')
    .map(a => ({ id: a.id, type: a.type, description: a.description, task: fit(a.task, SHARED_TASK), startedAt: a.startedAt, tools: a.tools, tool: a.tool }))
  const text = JSON.stringify(running)
  if (text !== runtime.lastShared || at - runtime.lastSharedAt >= HEARTBEAT_MS) {
    await $.store.set(`agents:${id}`, { at, agents: running })
    runtime.lastShared = text
    runtime.lastSharedAt = at
  }

  const asked = await $.store.get(`rename:${id}`)
  if (typeof asked === 'string' && asked.trim() !== '') {
    await $.store.delete(`rename:${id}`)
    await renameSelf($, asked.trim())
  }
}

// A subagent as it starts: its own tasks nest under the plan step in
// progress then; one spawned by another agent nests where that agent does.
async function recordAgent($: EngineInterface, spawned: Spawned) {
  runtime.isBusy = true
  const at = await $.clock.now()
  const spawner = (await read($, agents)).find(a => a.agentId !== undefined && a.agentId === spawned.parentId)
  const stepId =
    spawner !== undefined
      ? spawner.stepId
      : (await read($, steps)).find(step => step.status === 'in_progress' && !step.id.includes('/'))?.id
  const agent: Agent = {
    id: spawned.agentId ?? `${spawned.fallbackId}@${at}`,
    agentId: spawned.agentId,
    parentId: spawned.parentId,
    stepId,
    type: spawned.type,
    description: spawned.description,
    task: spawned.task,
    state: 'running',
    startedAt: at,
    tools: 0,
  }
  await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-50))
  await update($, now, () => at)
}

// Claude Code's own /rename, so the name is the one /resume and the prompt
// box show; the list is read again to show it.
async function renameSelf($: EngineInterface, name: string) {
  await $.command.run({ command: 'rename', args: name }).catch(() => undefined)
  await readSessions($, true)
}

// r: renames this session, or asks another session's glimt to take the
// name through the store: it does within POLL_MS.
async function renameSession($: EngineInterface, sessionId: string, name: string) {
  await update($, composer, () => null)
  if (name.trim() === '') {
    return
  }

  if (sessionId === (await read($, self))) {
    await renameSelf($, name.trim())
    return
  }
  await $.store.set(`rename:${sessionId}`, name.trim())
  $.ui.toast(`Asked the session to take the name ${name.trim()}`)
}

// n: a new agent for the task, a subagent here or a new background session
// in this session's folder.
async function spawnAgent($: EngineInterface, task: string, where: 'here' | 'session') {
  await update($, composer, () => null)
  const text = task.trim()
  if (text === '') {
    return
  }

  if (where === 'here') {
    const description = fit(text.split('\n')[0] ?? text, 40)
    const started = await $.agent.spawn({ prompt: text, description, subagentType: 'general-purpose' }).catch(() => undefined)
    if (started === undefined || started.deny !== undefined) {
      $.ui.toast(`The agent did not start${started?.deny === undefined ? '' : `: ${started.deny}`}`)
      return
    }
    // This plugin's own spawn passes no agent.spawn hook of its own.
    await recordAgent($, { agentId: started.agentId, fallbackId: 'glimt', type: 'general-purpose', description, task: text })
    return
  }

  const cwd = await $.session.cwd().catch(() => undefined)
  const ran = await $.process.run(['claude', '--bg', text], { cwd, timeoutMs: 30_000 }).catch(() => undefined)
  const why = ran?.stderr.trim().split('\n')[0] || 'claude --bg did not run'
  $.ui.toast(ran?.exitCode === 0 ? `Started a background session ${ran.stdout.trim()}` : `The session did not start: ${why}`)
  await readSessions($, true)
}

// n and r open a form at the top of the pane, its field taking the keyboard.
async function openComposer($: EngineInterface, next: Composer) {
  await update($, composer, () => next)
  await $.ui.focus({ requestId: PANE, key: 'composer-field' }).catch(() => undefined)
}

// c asks before clearing this conversation; y runs Claude Code's own /clear,
// whose conversation /resume still opens; n keeps it.
async function answerClear($: EngineInterface, isYes: boolean) {
  await update($, clearing, () => false)
  if (isYes) {
    await $.command.run({ command: 'clear' }).catch(() => undefined)
  }
}

// The session a and x act on: the one drilled into, or the one the cursor is on.
async function targetSession($: EngineInterface): Promise<Session | undefined> {
  const top = (await read($, opened)).at(-1)
  const list = await read($, sessions)
  if (top !== undefined) {
    return top.kind === 'session' ? list?.find(s => s.sessionId === top.sessionId) : undefined
  }

  const key = await read($, cursor)
  return list?.find(s => key === `toggle-session-${s.sessionId}`)
}

// a: copies the command that opens a background session in a terminal.
async function attachSession($: EngineInterface) {
  const s = await targetSession($)
  if (s === undefined || !isReachable(s)) {
    return
  }

  const command = `claude attach ${s.id}`
  const copied = await $.ui.copy({ text: command })
  $.ui.toast(copied.isCopied ? `Copied: ${command}` : `Could not copy: ${command}`)
}

// x: asks before stopping a background session; y or n answers.
async function askStop($: EngineInterface) {
  const s = await targetSession($)
  if (s !== undefined && isReachable(s)) {
    await update($, stopping, () => s.sessionId)
  }
}

// y stops the session with `claude stop`, which keeps its conversation; n
// keeps it running.
async function answerStop($: EngineInterface, isYes: boolean) {
  const asked = await read($, stopping)
  await update($, stopping, () => null)
  const s = (await read($, sessions))?.find(one => one.sessionId === asked)
  if (!isYes || s?.id === undefined) {
    return
  }

  const ran = await $.process.run(['claude', 'stop', s.id], { timeoutMs: 15_000 }).catch(() => undefined)
  const why = ran?.stderr.trim().split('\n')[0] || 'claude stop did not run'
  $.ui.toast(ran?.exitCode === 0 ? `Stopped ${s.name}` : `Could not stop ${s.name}: ${why}`)
  await readSessions($, true)
}

// The message field of the agent or the session drilled into: sends, then
// hands the keys back to the pane (the ring onto the way back), so h and the
// rest work again at once. Enter on an empty field just leaves it.
async function sendFromField($: EngineInterface, to: { sessionId: string } | { agentId: string }, name: string, text: string) {
  await sendMessage($, to, name, text)
  await $.ui.focus({ requestId: PANE, key: 'back' }).catch(() => undefined)
}

// Sends the text to an agent or a session, as a message from this session.
async function sendMessage($: EngineInterface, to: { sessionId: string } | { agentId: string }, name: string, text: string) {
  if (text.trim() === '') {
    return
  }

  const sent = await $.session
    .send({ to, text: text.trim() })
    .catch((error: unknown) => ({ isDelivered: false as const, reason: String(error) }))
  $.ui.toast(sent.isDelivered ? `Sent to ${name}` : `Not sent to ${name}: ${sent.reason}`)
}

// Moves the clock on every frame while something runs, another session
// included. Idle, it looks once a second, and moves only while a step is in
// progress or another session is listed, so their ages count on.
async function tick($: EngineInterface) {
  // A form left open by Esc, the pane no longer holding the keyboard, closes.
  if (!runtime.isFocused && (await read($, composer)) !== null) {
    await update($, composer, () => null)
  }
  runtime.ticks += 1
  if (!runtime.isBusy && runtime.ticks % 10 !== 0) {
    return
  }

  const request = await read($, focus)
  const team = await read($, agents)
  const selfId = await read($, self)
  const others = ((await read($, sessions)) ?? []).filter(s => s.sessionId !== selfId)
  runtime.isBusy = isTurnRunning(request) || team.some(a => a.state === 'running') || others.some(isSessionBusy)
  if (!runtime.isBusy && others.length === 0 && !(await read($, steps)).some(step => step.status === 'in_progress')) {
    return
  }

  const at = await $.clock.now()
  await update($, now, () => at)
}
