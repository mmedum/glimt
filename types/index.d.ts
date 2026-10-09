export type StepStatus = 'pending' | 'in_progress' | 'completed'

// One step of the plan, as Claude's task list (or TodoWrite) holds it.
// `description` is undefined until known: a task seeded from TaskList is
// read with TaskGet the first time it is opened. `startedAt` is when it went
// in progress, while it is; unknown for one seeded already in progress.
// `parentId` is the step it is a sub-step of. A subagent's own tasks join the
// plan with ids led by the agent's ("<agentId>/<taskId>").
export type Step = {
  id: string
  subject: string
  description?: string | undefined
  activeForm?: string | undefined
  status: StepStatus
  startedAt?: number | undefined
  parentId?: string | undefined
}

export type AgentState = 'running' | 'done' | 'failed' | 'stopped'

// One subagent, from its spawn to the end of its run. `parentId` is the
// agentId of the agent that spawned it, undefined when the main conversation
// did; `stepId` is the plan step in progress when it started, which its own
// tasks nest under; `task` is the prompt it was given; `tool` and `doing` say
// what its running call is and what that call is on; `tokens` is the size of
// its context: what its latest model request carried, and the reply.
export type Agent = {
  id: string
  agentId?: string | undefined
  parentId?: string | undefined
  stepId?: string | undefined
  type: string
  description: string
  task: string
  state: AgentState
  startedAt: number
  endedAt?: number | undefined
  tools: number
  tool?: string | undefined
  doing?: string | undefined
  tokens?: number | undefined
  // How full its context window is, in percent: known for the main
  // conversation alone.
  percent?: number | undefined
}

// The main conversation's latest turn: when it started and ended, how it
// ended, the tool it runs now, how many calls it has made and its context.
export type Focus = {
  startedAt?: number | undefined
  endedAt?: number | undefined
  outcome?: AgentState | undefined
  tools?: number | undefined
  tool?: string | undefined
  doing?: string | undefined
  tokens?: number | undefined
  percent?: number | undefined
}

// A plan approved in plan mode.
export type Plan = { title: string; path?: string | undefined }

// One Claude Code session on this machine, as `claude agents --json` lists
// it. `id` is a background session's short id, what `claude attach` and
// `claude stop` take; `status` is busy, waiting or idle for every session,
// `state` working, blocked (waiting for the person) and the like for a
// background one; `waitingFor` says why it waits ("permission prompt",
// "input needed", ...).
export type Session = {
  sessionId: string
  id?: string | undefined
  name: string
  cwd: string
  kind: string
  status?: string | undefined
  state?: string | undefined
  waitingFor?: string | undefined
  pid?: number | undefined
  startedAt: number
}

// What a session is doing, as its mark says it.
export type SessionState = 'waiting' | 'working' | 'idle'

// Another session's state as glimt has watched it: since when, undefined
// while glimt has not seen it begin, and whether it stopped (went idle or
// waiting) since the person last opened it.
export type Phase = { state: SessionState; since?: number | undefined; isUnseen: boolean }

// A running agent of another session, as that session's glimt shares it
// through the store every session on the machine reads.
export type SharedAgent = { id: string; type: string; description: string; task: string; startedAt: number; tools: number; tool?: string | undefined }

// What a session's glimt shares: when it last did, and its running agents.
export type Shared = { at: number; agents: SharedAgent[] }

// The form open at the top of the pane: a new agent, here or as a new
// background session, or a new name for a session.
export type Composer = { kind: 'spawn'; where: 'here' | 'session' } | { kind: 'rename'; sessionId: string }

// One step of the way l drilled in, in place of the overview: one of this
// session's agents (by its Agent id), another session, or one of another
// session's agents. `from` is the toggle the cursor was on, where h puts it
// back.
export type Opened = (
  | { kind: 'agent'; id: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'remote'; sessionId: string; agentId: string }
) & { from?: string | undefined }

// One subagent of another session, as that session's transcript folder lists
// it: its type and description from the agent's meta file, and when its
// transcript was last written.
export type RemoteAgent = { id: string; type: string; description: string; writtenAt: number }

// Another session's subagents, the newest written first, as many as are
// read; `total` counts every one in the folder.
export type RemoteList = { agents: RemoteAgent[]; total: number }

// One item of an agent's or a session's latest activity: what it was asked,
// what Claude said, or a call it made ("Read · /a/b.ts").
export type Activity = { kind: 'asked' | 'said' | 'call'; text: string }

// The activity last read for what the pane is drilled into, oldest first, or
// why it could not be read.
export type Feed = { items: Activity[]; error?: string | undefined }

declare module 'claude-code' {
  interface PluginState {
    glimt: {
      focus: Focus | null
      plan: Plan | null
      steps: Step[]
      agents: Agent[]
      now: number
      // Whether the pane is drawn, so the chat can leave out what it shows.
      isShown: boolean
      // The steps, and the agents ("agent:" and the id), opened to show more.
      expanded: string[]
      // The toggle j, k and o act on, drawn highlighted.
      cursor: string | null
      // Every session, as last read; null before the first read.
      sessions: Session[] | null
      // Why the last read failed, until one succeeds.
      sessionsError: string | null
      // The other sessions' states as glimt watched them, by session id.
      phases: Record<string, Phase>
      // Whether this session's requests offer Claude a task list; null
      // before the first. Once one does, it stays true.
      hasTaskList: boolean | null
      // The session `x` asked to stop, waiting for y or n.
      stopping: string | null
      // This session's id, to leave it out of the list: the pane is about it.
      self: string | null
      // What the other sessions' glimts share, by session id, fresh ones only.
      shared: Record<string, Shared>
      composer: Composer | null
      // Whether c asked to clear this conversation, waiting for y or n.
      clearing: boolean
      // The way l drilled in, the last step on show; empty for the overview.
      opened: Opened[]
      // The last step's latest activity; null until the first read.
      feed: Feed | null
      // The subagents of the sessions opened or drilled into, by session id.
      remote: Record<string, RemoteList>
      // Another session's agents' tasks as read, by "<sessionId>:<agentId>".
      remoteTasks: Record<string, string>
      // Whether i opened the key list in place of the pane's body.
      help: boolean
    }
  }
}
