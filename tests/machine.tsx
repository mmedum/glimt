// The machine beneath glimt for the session tests: the session list, files,
// transcripts and the store every session's glimt shares.

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { mount, startSession } from './kit'
import type { Mounted } from './kit'

// What `claude agents --json` lists: this session ("self-full") and one
// other of each state, in an order the pane sorts.
export const LISTED = [
  { pid: 65767, cwd: '/home/demo/code/docs', kind: 'interactive', startedAt: 60_000, sessionId: '1879e383-full', name: 'docs-site', status: 'idle' },
  { id: 'd3d04fc1', cwd: '/home/demo/code', kind: 'background', startedAt: 0, sessionId: 'd3d04fc1-full', name: 'release-notes', state: 'blocked' },
  {
    pid: 50727,
    id: 'ba4f4809',
    cwd: '/home/demo/code',
    kind: 'background',
    startedAt: 0,
    sessionId: 'self-full',
    name: 'glimt work',
    status: 'busy',
    state: 'working',
  },
  { pid: 294443, cwd: '/srv/api', kind: 'interactive', startedAt: 0, sessionId: 'a15af547-full', name: 'api-refactor', status: 'busy' },
]

// LISTED with docs-site at work.
export const DOCS_BUSY = LISTED.map(s => (s.sessionId === '1879e383-full' ? { ...s, status: 'busy' } : s))

export type Machine = { ran: string[][]; toasts: string[]; copied: string[]; clock: ReturnType<typeof mock.clock>; store: Map<string, unknown> }
export type MachineOptions = {
  listed?: unknown
  // What `claude agents --json` lists from the next read on, in place of
  // `listed`, for a test that changes it.
  relisted?: { current: unknown }
  stdout?: string
  stderr?: string
  stopError?: string
  // `claude agents --json` fails without a word.
  listFails?: boolean
  placed?: boolean[]
  transcript?: string
  files?: string[]
  folders?: string[]
  dirs?: Record<string, { name: string; mtimeMs: number }[]>
  texts?: Record<string, string>
  outputs?: Record<string, string>
  stored?: Record<string, unknown>
  selfId?: { current: string }
}

// The machine beneath the plugin, an hour in: `claude agents --json` prints
// `listed` (`relisted` once set, or `stdout` as given, or fails with
// `stderr`), `claude stop`
// stops (or fails with `stopError`), `head` and `tail` print a file's
// `outputs` (else `transcript`), the files in `files` exist, Claude Code's
// projects folder holds `folders`, each of `dirs` lists its files, `texts`
// are the files read whole and the store holds `stored`; the home folder is
// /home/demo and this session is "self-full". Starts the session.
export async function machine($: Engine, on: On, options: MachineOptions = {}): Promise<Machine> {
  const { listed = LISTED, stdout, stderr = '', stopError = '', placed = [true], transcript = '', files = [], folders = [] } = options
  const {
    dirs = {},
    texts = {},
    outputs = {},
    stored = {},
    selfId = { current: 'self-full' },
    listFails = false,
    relisted = { current: undefined },
  } = options
  const seen = { ran: [] as string[][], toasts: [] as string[], copied: [] as string[] }
  const clock = mock.clock(on, { now: 3_600_000 })
  mock.env(on, { HOME: '/home/demo' })
  on('session.id', () => ({ value: selfId.current }))
  on('fs.exists', (_$, e) => ({ value: files.includes(e.path) }))
  // The store every session's glimt shares, starting with `stored`.
  const store = new Map(Object.entries(stored))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('fs.list', (_$, e) => ({
    value:
      e.path === '/home/demo/.claude/projects'
        ? folders.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
        : (dirs[e.path] ?? []).map(entry => ({ ...entry, kind: 'file' as const, size: 1, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const text = texts[e.path]
    if (text === undefined) {
      throw new Error(`no such file: ${e.path}`)
    }
    return { value: text }
  })
  on('process.run', (_$, e) => {
    seen.ran.push([...e.argv])
    if (e.argv[0] === 'tail' || e.argv[0] === 'head') {
      const text = outputs[e.argv.at(-1) ?? ''] ?? transcript
      const printed = e.argv[0] === 'head' ? `${text.split('\n')[0] ?? ''}\n` : text
      return { value: { exitCode: 0, stdout: printed, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const isList = e.argv[1] === 'agents'
    const error = isList ? stderr : stopError
    const printed = isList ? (stdout ?? JSON.stringify(relisted.current ?? listed)) : ''
    const failed = error !== '' || (isList && listFails)
    return { value: { exitCode: failed ? 1 : 0, stdout: printed, stderr: error, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  await startSession($, on, { placed })
  await clock.settle()

  return { ...seen, clock, store }
}

export const listReads = (ran: string[][]) => ran.filter(argv => argv.join(' ') === 'claude agents --json').length
export const stops = (ran: string[][]) => ran.filter(argv => argv[1] === 'stop')
export const sessionOrder = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' }))
    .map(box => box.key)
    .filter(key => key !== undefined && key.startsWith('session-') && !key.startsWith('session-detail-'))
export const offered = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Button' })).map(button => button.key).filter(key => key === 'key-attach' || key === 'key-stop')

// The pane, focused, its cursor on the `nth` other session (1 is the
// first): past this session's row, with no step or agent between.
export async function onSession($: Engine, nth: number) {
  const ui = await mount($, { isFocused: true })
  for (let row = 0; row <= nth; row += 1) {
    await ui.press({ key: 'key-down' })
  }
  return ui
}

// The tail of docs-site's transcript: a line the tail cut, the person's
// prompt, lines Claude Code adds itself, Claude's text and a call, the
// call's result, a subagent's line and an attachment.
export const TAIL = [
  'cut": true}',
  ...[
    { type: 'user', message: { role: 'user', content: 'Check the build' } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: the messages below were generated' } },
    { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Running it now.' }] } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test\n--watch' } }] },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'A subagent speaks' }] } },
    { type: 'attachment', attachment: { type: 'todo_reminder' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All 12 tests pass.' }] } },
  ].map(line => JSON.stringify(line)),
  '',
].join('\n')
export const DOCS = '/home/demo/.claude/projects/-home-demo-code-docs/1879e383-full.jsonl'
export const tails = (ran: string[][]) => ran.filter(argv => argv[0] === 'tail')

// docs-site's subagents, beside its transcript, an hour in: b1 written 10
// seconds ago, b3 exactly a minute ago, b2 a minute and a millisecond ago;
// a file that is no agent's.
export const SUBAGENTS = '/home/demo/.claude/projects/-home-demo-code-docs/1879e383-full/subagents'
export const AGENT_FILES = {
  [SUBAGENTS]: [
    { name: 'agent-b2.jsonl', mtimeMs: 3_600_000 - 60_001 },
    { name: 'agent-b2.meta.json', mtimeMs: 3_600_000 - 60_001 },
    { name: 'agent-b1.jsonl', mtimeMs: 3_600_000 - 10_000 },
    { name: 'agent-b1.meta.json', mtimeMs: 3_600_000 - 10_000 },
    { name: 'agent-b3.jsonl', mtimeMs: 3_600_000 - 60_000 },
    { name: 'agent-b3.meta.json', mtimeMs: 3_600_000 - 60_000 },
    { name: 'notes.txt', mtimeMs: 3_600_000 },
  ],
}
export const METAS = {
  [`${SUBAGENTS}/agent-b1.meta.json`]: JSON.stringify({ agentType: 'Explore', description: 'find loaders' }),
  [`${SUBAGENTS}/agent-b2.meta.json`]: JSON.stringify({ agentType: 'general-purpose', description: 'review the diff' }),
  [`${SUBAGENTS}/agent-b3.meta.json`]: JSON.stringify({ agentType: 'Plan', description: 'plan the move' }),
}
// b1's own transcript: its task, a call and what it found.
export const B1 = `${[
  { type: 'user', isSidechain: true, message: { role: 'user', content: 'Find where hooks are loaded.' } },
  {
    type: 'assistant',
    isSidechain: true,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'register' } }] },
  },
  { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'It is in hooks/load.ts.' }] } },
]
  .map(line => JSON.stringify(line))
  .join('\n')}\n`
export const AGENTS_MACHINE: MachineOptions = {
  transcript: TAIL,
  files: [DOCS],
  dirs: AGENT_FILES,
  texts: METAS,
  outputs: { [`${SUBAGENTS}/agent-b1.jsonl`]: B1 },
}
