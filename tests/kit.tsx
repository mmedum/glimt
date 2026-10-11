// What every test file shares: the pane mounted as a terminal docks it, and
// the engine's side of tasks, turns and agents.

import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

export type PaneSize = { surface?: Surface; columns?: number; rows?: number; placement?: 'dock' | 'inline'; isFocused?: boolean }

// The size each mounted pane was drawn at, for setFocus to draw it again.
const sizes = new WeakMap<object, PaneSize>()

// The pane as a terminal docks it: `columns` wide and `rows` tall.
export async function mount($: Engine, { surface = 'terminal', ...size }: PaneSize = {}) {
  const ui = await $.ui.mount({ plugin: 'glimt', surface, component: 'Pane', requestId: 'glimt', props: paneProps(size) })
  sizes.set(ui, size)

  return ui
}

function paneProps({ columns = 72, rows = 40, placement = 'dock', isFocused = false }: PaneSize) {
  return { title: 'glimt', isFocused, bodyColumns: columns, placement, scroll: { offset: 0, bodyRows: rows }, view: {} }
}

export type Mounted = Awaited<ReturnType<typeof mount>>

// The person gives the pane the keyboard (ctrl+x tab), or gives it back to
// the prompt (Esc): Claude Code draws the pane again, at the size it was
// mounted at.
export function setFocus(ui: Mounted, isFocused: boolean) {
  return ui.redraw(paneProps({ ...sizes.get(ui), isFocused }))
}

// Closes the pane as any plugin's $.ui.close does, the close mark's way in:
// through glimt's ui.close hook, which glimt's own q never reaches.
export const CLOSER: Plugin = {
  name: 'closer',
  register: on => {
    on('command.run', { command: 'close-glimt' }, async $ => {
      await $.ui.close({ id: 'glimt' })
      return {}
    })
  },
}

// Claude Code's focus ring beneath glimt: a move lands where it is asked.
export function focusRing(on: On) {
  on('ui.focus', () => ({}))
}

// Up, Down or Tab onto `element`, as the person moves Claude Code's focus
// ring; glimt's cursor follows it onto a row's toggle. Needs focusRing.
export function moveTo($: Engine, element: string) {
  return $.ui.focus({ component: 'Pane', requestId: 'glimt', element, origin: { kind: 'person' } })
}

export async function textOf(ui: Mounted, key: string) {
  return (await ui.find({ key }))?.text
}

export type ListedTask = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; blockedBy: string[] }

export type SessionOptions = { tasks?: ListedTask[]; placed?: boolean[]; askedFocus?: boolean[]; titles?: unknown[] }

// The engine's side of starting a session: `tasks` is what TaskList finds,
// `placed` whether each opening of the pane draws it, the last answer
// standing for every later one, and `askedFocus` and `titles` collect
// whether each opening asked for the keyboard and the title it gave.
// Register every other hook first.
export function startSession($: Engine, on: On, { tasks = [], placed = [true], askedFocus = [], titles = [] }: SessionOptions = {}) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    const isPlaced = placed[Math.min(askedFocus.length, placed.length - 1)]
    askedFocus.push(e.focus === true)
    titles.push(e.title)
    return { value: isPlaced === true ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
  on('tool.call', { tool: 'TaskList' }, () => ({ result: { tasks } }))

  return $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

// A test that moves the clock a minute or more redraws the pane every 100 ms
// frame on the way, about a thousand times: on a busy machine that takes
// longer than the default 5 seconds.
export const LONG_CLOCK = { timeoutMs: 30_000 }

export function prompts(on: On) {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
}

export function ask($: Engine, text: string, kind: 'composer' | 'task-notification' = 'composer') {
  return $.prompt.submit({ text, wait: false, origin: { kind } })
}

// The prompt box beneath the plugin: an edit leaves the draft as it was.
export function promptBox(on: On) {
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }))
}

// The person types `typed` at the end of the draft `text`. The kit's $
// raises prompt.edit, though its types leave the call out. Needs promptBox.
export function typeInPrompt($: Engine, text: string, typed: string) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const prompt = $.prompt as unknown as { edit: (input: unknown) => Promise<unknown> }
  return prompt.edit({ text, cursor: text.length, start: text.length, end: text.length, inputText: typed, origin: { kind: 'composer' } })
}

// A call made in a subagent's loop. The kit's $ carries agentId as the query
// loop does, though the types of a call's input leave it out.
export function inAgent<T extends object>(input: T, agentId: string | undefined): T {
  return agentId === undefined ? input : { ...input, agentId }
}

// Claude Code's task tools beneath the plugin, numbering tasks from 1 as it does.
export function taskTools(on: On) {
  let last = 0
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(++last), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: [] } }))
}

export type CreateOptions = { activeForm?: string | undefined; description?: string; agentId?: string | undefined; parent?: string | undefined }

export function create($: Engine, subject: string, { activeForm, description = '', agentId, parent }: CreateOptions = {}) {
  // Only the fields the call sets, as the model sends them.
  const optional = { ...(activeForm === undefined ? {} : { activeForm }), ...(parent === undefined ? {} : { metadata: { parent } }) }
  return $.tool.call(inAgent({ tool: 'TaskCreate', subject, description, ...optional }, agentId))
}

// The steps' rows in the order drawn.
export async function stepOrder(ui: Mounted) {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key).filter(key => key?.startsWith('step-') === true)
}

export function setStatus($: Engine, taskId: string, status: 'pending' | 'in_progress' | 'completed' | 'deleted') {
  return $.tool.call({ tool: 'TaskUpdate', taskId, status })
}

// The engine's side of turns and subagents: agent ids are the tool_use_id
// less its "tu-".
export function loops(on: On) {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.tool_use_id.slice(3) }))
  on('turn.complete', () => ({ text: '' }))
}

export type SpawnOptions = { type?: string; parent?: string; prompt?: string; background?: boolean }

export function spawn(
  $: Engine,
  agentId: string,
  description: string,
  { type = 'Explore', parent, prompt = description, background = false }: SpawnOptions = {},
) {
  return $.agent.spawn({
    tool_use_id: `tu-${agentId}`,
    prompt,
    description,
    subagentType: type,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    ...(parent === undefined ? {} : { parentAgentId: parent }),
    background,
    fork: false,
  })
}

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// The engine's side of model requests: each reports the usage last set.
export function modelRequests(on: On) {
  let usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  // The engine's turn.step hook is a generator; this one streams nothing.
  // oxlint-disable-next-line eslint/require-yield
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: 'claude-haiku-5-5' } }
  })

  return (next: Usage) => {
    usage = next
  }
}

// One model request in a loop: the main conversation's, or an agent's.
export async function modelRequest($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  for await (const _chunk of stream) {
    // Read to the end, as the loop does.
  }

  return stream.result
}

export function tokens(input: number, cacheRead: number, cacheWrite: number, output: number): Usage {
  return { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: output }
}

export function finish($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') {
  return $.turn.complete({ answer: '', durationMs: 0, isAborted: reason === 'aborted', turnId: `turn-${agentId}`, agentId, reason })
}
