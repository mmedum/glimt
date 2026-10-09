import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LONG_CLOCK, loops, modelRequest, modelRequests, mount, moveTo, textOf } from './kit'
import { DOCS_BUSY, LISTED, DOCS, TAIL, listReads, machine, offered, onSession, sessionOrder, stops, tails } from './machine'

describe('sessions', () => {
  test('lists the other sessions under Agents: waiting first, then working, then idle', async ($, on) => {
    await machine($, on)
    const ui = await mount($)

    expect(await textOf(ui, 'sessions-heading')).toBe('Sessions  1 waiting · 1 working')
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
    // Seen in these states from the first read: since when is not known.
    expect(await textOf(ui, 'session-d3d04fc1-full')).toBe('▸ ◉ release-notes waiting')
    expect(await textOf(ui, 'session-a15af547-full')).toBe('▸ ⠋ api-refactor working')
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle')
  })

  // An escaped bug: a session in a terminal of its own says it waits by its
  // status alone, and showed as idle.
  test('marks a session in its own terminal that waits for its person, and sorts it first', async ($, on) => {
    const asking = {
      pid: 7,
      cwd: '/tmp',
      kind: 'interactive',
      startedAt: 0,
      sessionId: 'tty-1',
      name: 'migration',
      status: 'waiting',
      waitingFor: 'permission prompt',
    }
    await machine($, on, { listed: [...LISTED.filter(s => s.sessionId !== 'd3d04fc1-full'), asking] })
    const ui = await mount($)

    expect(await textOf(ui, 'sessions-heading')).toBe('Sessions  1 waiting · 1 working')
    expect(await sessionOrder(ui)).toEqual(['session-tty-1', 'session-a15af547-full', 'session-1879e383-full'])
    expect(await textOf(ui, 'session-tty-1')).toBe('▸ ◉ migration approve')
  })

  test('says what a waiting session wants, by why it waits', async ($, on) => {
    const waits = (id: string, waitingFor?: string) => ({
      cwd: `/tmp/${id}`,
      kind: 'interactive',
      startedAt: 0,
      sessionId: id,
      name: id,
      status: 'waiting',
      ...(waitingFor === undefined ? {} : { waitingFor }),
    })
    await machine($, on, {
      listed: [
        waits('s1', 'permission prompt'),
        waits('s2', 'sandbox request'),
        waits('s3', 'input needed'),
        waits('s4', 'dialog open'),
        waits('s5'),
      ],
    })
    const ui = await mount($)

    expect(await textOf(ui, 'session-s1')).toBe('▸ ◉ s1 approve')
    expect(await textOf(ui, 'session-s2')).toBe('▸ ◉ s2 approve')
    expect(await textOf(ui, 'session-s3')).toBe('▸ ◉ s3 answer')
    expect(await textOf(ui, 'session-s4')).toBe('▸ ◉ s4 waiting')
    expect(await textOf(ui, 'session-s5')).toBe('▸ ◉ s5 waiting')
  })

  test("counts a state's time from the read that saw it begin", LONG_CLOCK, async ($, on) => {
    const relisted = { current: undefined as unknown }
    const { clock } = await machine($, on, { listed: DOCS_BUSY, relisted })
    const ui = await mount($)

    // docs-site stops; the read 5 seconds on sees it, at 3,605,000.
    relisted.current = LISTED
    await clock.advance(5_000)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · <1m')
    await clock.advance(59_900)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · <1m')
    await clock.advance(100)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · 1m')
  })

  test('a session that stops shows its name in bold until it is opened or gone into', async ($, on) => {
    const relisted = { current: undefined as unknown }
    const { clock } = await machine($, on, { listed: DOCS_BUSY, relisted })
    // docs-site works, so it is the second of the others.
    const ui = await onSession($, 2)
    const isBold = async () => (await ui.findAll({ type: 'Text' })).find(text => text.text === 'docs-site')?.props.bold === true
    expect(await isBold()).toBe(false)

    relisted.current = LISTED
    await clock.advance(5_000)
    expect(await isBold()).toBe(true)
    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect(await isBold()).toBe(false)

    // It works again, and stops again: bold until l goes into it.
    await ui.press({ key: 'toggle-session-1879e383-full' })
    relisted.current = DOCS_BUSY
    await clock.advance(5_000)
    expect(await isBold()).toBe(false)
    relisted.current = LISTED
    await clock.advance(5_000)
    expect(await isBold()).toBe(true)
    await ui.press({ key: 'key-into' })
    await ui.press({ key: 'back' })
    expect(await isBold()).toBe(false)
  })

  test('before anything has happened, says in one line what will show', async ($, on) => {
    await machine($, on, { listed: [LISTED[2]] })
    const ui = await mount($)

    expect(await textOf(ui, 'empty')).toBe('glimt · the plan, agents and other sessions show here as they start')
    expect(await ui.find({ key: 'plan-heading' })).toBeUndefined()
  })

  test('says so when no other session runs', async ($, on) => {
    loops(on)
    await machine($, on, { listed: [LISTED[2]] })
    await $.turn.start({ text: '', turnId: 't1' })
    const ui = await mount($)

    expect(await textOf(ui, 'sessions-heading')).toBe('Sessions')
    expect(await textOf(ui, 'no-sessions')).toBe('No other sessions.')
  })

  test('folds the idle sessions into one line when the room runs short', async ($, on) => {
    const idleToo = { pid: 1, cwd: '/tmp/idle', kind: 'interactive', startedAt: 0, sessionId: 'idle-2', name: 'second idle', status: 'idle' }
    await machine($, on, { listed: [...LISTED, idleToo] })

    // 16 rows give the sessions 4: the heading and three lines, for four sessions.
    const ui = await mount($, { rows: 16 })
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full'])
    expect(await textOf(ui, 'sessions-idle')).toBe('  ○ 2 idle')
  })

  test('reads the list at start and every 5 seconds while the pane is drawn', async ($, on) => {
    const drawn = await machine($, on)
    await drawn.clock.advance(10_000)
    expect(listReads(drawn.ran)).toBe(3)
  })

  test('reads the list once at start while the pane waits for room', async ($, on) => {
    const waiting = await machine($, on, { placed: [false] })
    await waiting.clock.advance(10_000)
    expect(listReads(waiting.ran)).toBe(1)
  })

  test('shows the first line of why the list could not be read', async ($, on) => {
    await machine($, on, { stderr: 'error: agent view is off\nmore detail' })
    const ui = await mount($)

    expect(await textOf(ui, 'sessions-error')).toBe('error: agent view is off')
  })

  test('says it could not run claude agents when it fails without a word', async ($, on) => {
    await machine($, on, { listFails: true })
    const ui = await mount($)

    expect(await textOf(ui, 'sessions-error')).toBe('Could not run claude agents --json')
  })

  test('shows an error when claude agents prints something other than a list', async ($, on) => {
    await machine($, on, { stdout: '{"sessions": []}' })
    const ui = await mount($)

    expect(await ui.find({ key: 'sessions-error' })).toBeDefined()
  })

  test('leaves out an entry with no session id', async ($, on) => {
    await machine($, on, { listed: [{ name: 'no id', state: 'blocked' }, 7, null, LISTED[1]] })
    const ui = await mount($)

    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full'])
  })

  test('offers a and x only while the cursor is on a background session', async ($, on) => {
    await machine($, on)
    const quiet = await mount($, { isFocused: true })
    expect(await offered(quiet)).toEqual([])
    await quiet.unmount()

    const background = await onSession($, 1)
    expect(await offered(background)).toEqual(['key-attach', 'key-stop'])
    await moveTo($, 'toggle-session-a15af547-full')
    expect(await offered(background)).toEqual([])
  })

  test("a copies a background session's attach command", async ($, on) => {
    const { copied } = await machine($, on)
    const ui = await onSession($, 1)

    await ui.press({ key: 'key-attach' })
    expect(copied).toEqual(['claude attach d3d04fc1'])
  })

  test('x asks first: n keeps the session, y stops it with claude stop', async ($, on) => {
    const { ran } = await machine($, on)
    const ui = await onSession($, 1)

    await ui.press({ key: 'key-stop' })
    expect((await textOf(ui, 'stop-d3d04fc1-full'))?.startsWith('Stop release-notes?')).toBe(true)
    await ui.press({ key: 'stop-no' })
    expect(await ui.find({ key: 'stop-d3d04fc1-full' })).toBeUndefined()
    expect(stops(ran)).toEqual([])

    await ui.press({ key: 'key-stop' })
    await ui.press({ key: 'stop-yes' })
    expect(stops(ran)).toEqual([['claude', 'stop', 'd3d04fc1']])
  })

  test("passes on claude stop's reason when it fails", async ($, on) => {
    const { toasts } = await machine($, on, { stopError: 'error: no such session\nmore detail' })
    const ui = await onSession($, 1)

    await ui.press({ key: 'key-stop' })
    await ui.press({ key: 'stop-yes' })
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.endsWith('error: no such session')).toBe(true)
  })

  test('writes the home folder as ~ only up to a folder boundary', async ($, on) => {
    const at = (id: string, cwd: string) => ({ cwd, kind: 'interactive', startedAt: 0, sessionId: id, name: id, status: 'idle' })
    await machine($, on, { listed: [at('s1', '/home/demo'), at('s2', '/home/demo/api'), at('s3', '/home/demox/api')] })
    // Each opened in turn.
    const ui = await mount($)
    for (const id of ['s1', 's2', 's3']) {
      await ui.press({ key: `toggle-session-${id}` })
      expect(await ui.find({ key: `session-detail-${id}` })).toBeDefined()
    }
    const folder = async (id: string) => (await textOf(ui, `session-detail-${id}`))?.split(' · ')[0]

    expect(await folder('s1')).toBe('  ⎿ ~')
    expect(await folder('s2')).toBe('  ⎿ ~/api')
    expect(await folder('s3')).toBe('  ⎿ /home/demox/api')
  })

  test('an opened session shows its folder, kind and id', async ($, on) => {
    await machine($, on)
    const ui = await mount($)

    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect((await textOf(ui, 'session-detail-1879e383-full'))?.startsWith('  ⎿ ~/code/docs · terminal · 1879e383-full')).toBe(true)
  })

  test('passes on why a message was not delivered', async ($, on) => {
    on('session.send', () => ({ isDelivered: false, reason: 'the session has ended' }))
    const { toasts } = await machine($, on)
    const ui = await onSession($, 3)
    await ui.press({ key: 'key-into' })

    await ui.input({ key: 'message-field', text: 'check the build' })
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.endsWith('the session has ended')).toBe(true)
  })

  // An escaped bug: a send that threw went unhandled.
  test('reports a send that throws, leaving nothing unhandled', async ($, on) => {
    on('session.send', () => {
      throw new Error('the bridge is down')
    })
    const { toasts } = await machine($, on)
    const ui = await onSession($, 3)
    await ui.press({ key: 'key-into' })

    await ui.input({ key: 'message-field', text: 'check the build' })
    expect(toasts.length).toBe(1)
  })

  test("l goes into a session: its prompts, Claude's text and its calls from its transcript, newest last", async ($, on) => {
    const { ran } = await machine($, on, { transcript: TAIL, files: [DOCS] })
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-into' })
    expect(tails(ran)).toEqual([['tail', '-c', '131072', DOCS]])
    expect(await textOf(ui, 'drill-title')).toBe('○ docs-site  idle  ⎿ ~/code/docs · terminal · 1879e383-full')
    expect(await textOf(ui, 'activity')).toBe('› Check the build● Running it now.  ⎿ Bash · npm test● All 12 tests pass.')
    expect(await ui.find({ key: 'sessions-heading' })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await textOf(ui, 'sessions-heading')).toBe('Sessions  1 waiting · 1 working')
  })

  test("reads a session's transcript again every 2 seconds while the pane is in it, and stops on the way out", async ($, on) => {
    const { ran, clock } = await machine($, on, { transcript: TAIL, files: [DOCS] })
    const ui = await onSession($, 3)
    await ui.press({ key: 'key-into' })

    await clock.advance(4_000)
    expect(tails(ran).length).toBe(3)
    await ui.press({ key: 'back' })
    await clock.advance(4_000)
    expect(tails(ran).length).toBe(3)
  })

  test('finds a transcript in another project folder when the session started elsewhere', async ($, on) => {
    const moved = '/home/demo/.claude/projects/-home-demo-elsewhere/1879e383-full.jsonl'
    const { ran } = await machine($, on, { transcript: TAIL, files: [moved], folders: ['-home-demo-repos', '-home-demo-elsewhere'] })
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-into' })
    expect(tails(ran)).toEqual([['tail', '-c', '131072', moved]])
  })

  test("going into a session shows its latest reply's model and its git branch, read again every 30 seconds", LONG_CLOCK, async ($, on) => {
    // The session's own reply, then a subagent's on another model, which is not the session's.
    const transcript = `${[
      { type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.' }] } },
      {
        type: 'assistant',
        isSidechain: true,
        message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Found it.' }] },
      },
    ]
      .map(line => JSON.stringify(line))
      .join('\n')}\n`
    const { ran, clock } = await machine($, on, { transcript, files: [DOCS], branch: 'main' })
    const gits = () => ran.filter(argv => argv[0] === 'git')
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('○ docs-site  idle · Opus 5.5  ⎿ ~/code/docs on main · terminal · 1879e383-full')
    expect(gits()).toEqual([['git', '-C', '/home/demo/code/docs', 'rev-parse', '--abbrev-ref', 'HEAD']])
    await clock.advance(28_000)
    expect(gits().length).toBe(1)
    await clock.advance(2_000)
    expect(gits().length).toBe(2)
  })

  test('says so when a session has no transcript', async ($, on) => {
    const { ran } = await machine($, on, { folders: ['-home-demo-repos'] })
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-into' })
    expect(tails(ran)).toEqual([])
    expect(await textOf(ui, 'activity')).toBe('No transcript found for this session.')
  })

  test('a and x act on the session the pane is in', async ($, on) => {
    const { ran, copied } = await machine($, on, { transcript: TAIL })
    const ui = await onSession($, 1)
    await ui.press({ key: 'key-into' })

    await ui.press({ key: 'key-attach' })
    expect(copied).toEqual(['claude attach d3d04fc1'])
    await ui.press({ key: 'key-stop' })
    await ui.press({ key: 'stop-yes' })
    expect(stops(ran)).toEqual([['claude', 'stop', 'd3d04fc1']])
  })

  test('the message field of the session the pane is in sends to it', async ($, on) => {
    const sent: unknown[] = []
    on('session.send', (_$, e) => {
      sent.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })
    await machine($, on, { transcript: TAIL, files: [DOCS] })
    const ui = await onSession($, 3)
    await ui.press({ key: 'key-into' })

    await ui.input({ key: 'message-field', text: 'check the build' })
    // Claude Code hands the event the address as the session's id.
    expect(sent).toEqual([{ to: '1879e383-full', text: 'check the build' }])
  })
})

describe('notifications', () => {
  // release-notes, the background session, at work; then waiting to approve.
  const WORKING = LISTED.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, state: 'working', status: 'busy' } : s))
  const ASKING = LISTED.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, status: 'waiting', waitingFor: 'permission prompt' } : s))
  type Answer = { isSent: true; channel: 'ghostty' } | { isSent: false; reason: 'no-channel' | 'disabled' }

  function notifications(on: On, answer: { current: Answer } = { current: { isSent: true, channel: 'ghostty' } }) {
    const sent: string[] = []
    on('ui.notify', (_$, e) => {
      sent.push(e.text)
      return { value: answer.current }
    })
    return sent
  }

  test('tells of a background session that starts waiting, once', async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const { clock, toasts } = await machine($, on, { listed: WORKING, relisted })

    relisted.current = ASKING
    await clock.advance(10_000)
    expect(sent).toEqual(['release-notes needs your approval'])
    expect(toasts).toEqual([])
  })

  test('leaves the notification to a drawn pane whose session id sorts first', async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    // docs-site's glimt (1879e383-full sorts before self-full) has its pane drawn.
    const stored = { 'agents:1879e383-full': { at: 3_600_000, agents: [], watching: true } }
    const { clock } = await machine($, on, { listed: WORKING, relisted, stored })

    relisted.current = ASKING
    await clock.advance(10_000)
    expect(sent).toEqual([])
  })

  test("notifies when the panes that sort first are not drawn, or are the waiting session's own", async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const stored = {
      'agents:1879e383-full': { at: 3_600_000, agents: [], watching: false },
      'agents:d3d04fc1-full': { at: 3_600_000, agents: [], watching: true },
    }
    const { clock } = await machine($, on, { listed: WORKING, relisted, stored })

    relisted.current = ASKING
    await clock.advance(10_000)
    expect(sent).toEqual(['release-notes needs your approval'])
  })

  test('leaves alone a session already waiting at the first read, and one in a terminal of its own', async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const { clock } = await machine($, on, { listed: LISTED, relisted })

    relisted.current = LISTED.map(s => (s.sessionId === 'a15af547-full' ? { ...s, status: 'waiting', waitingFor: 'input needed' } : s))
    await clock.advance(10_000)
    expect(sent).toEqual([])
  })

  test('shows a toast where no channel sent it, and nothing where notifications are off', async ($, on) => {
    const answer: { current: Answer } = { current: { isSent: false, reason: 'no-channel' } }
    const sent = notifications(on, answer)
    const relisted = { current: undefined as unknown }
    const { clock, toasts } = await machine($, on, { listed: WORKING, relisted })

    relisted.current = ASKING
    await clock.advance(5_000)
    expect(toasts).toEqual(['release-notes needs your approval'])

    answer.current = { isSent: false, reason: 'disabled' }
    relisted.current = WORKING
    await clock.advance(5_000)
    relisted.current = ASKING
    await clock.advance(5_000)
    expect(sent.length).toBe(2)
    expect(toasts).toEqual(['release-notes needs your approval'])
  })

  test('tells of a background session that finishes, and marks it done', async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const { clock } = await machine($, on, { listed: WORKING, relisted })
    const ui = await mount($)

    relisted.current = WORKING.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, state: 'done', status: 'idle' } : s))
    await clock.advance(10_000)
    expect(sent).toEqual(['release-notes finished'])
    expect(await textOf(ui, 'session-d3d04fc1-full')).toBe('▸ ○ release-notes done · <1m')
    // Still done at the next read: told of once.
    await clock.advance(5_000)
    expect(sent).toEqual(['release-notes finished'])
  })

  test('tells of a background session that fails, and marks it failed', async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const { clock } = await machine($, on, { listed: LISTED, relisted })
    const ui = await mount($)

    relisted.current = LISTED.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, state: 'failed' } : s))
    await clock.advance(10_000)
    expect(sent).toEqual(['release-notes failed'])
    expect(await textOf(ui, 'session-d3d04fc1-full')).toBe('▸ ✗ release-notes failed · <1m')
  })

  // Idle at both reads: since when it idles is not known.
  test('leaves alone a session stopped, or already done at the first read, and marks the stopped one', async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const done = LISTED.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, state: 'done' } : s))
    const { clock } = await machine($, on, { listed: done, relisted })
    const ui = await mount($)

    relisted.current = LISTED.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, state: 'stopped' } : s))
    await clock.advance(10_000)
    expect(sent).toEqual([])
    expect(await textOf(ui, 'session-d3d04fc1-full')).toBe('▸ ■ release-notes stopped')
  })

  test("names the session by Claude Code's generated title", async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const notes = '/home/demo/.claude/projects/-home-demo-code-notes/d3d04fc1-full.jsonl'
    const title = `${JSON.stringify({ type: 'ai-title', aiTitle: 'Write the 0.4 notes', sessionId: 'd3d04fc1-full' })}\n`
    const { clock } = await machine($, on, { listed: WORKING, relisted, files: [notes], outputs: { [notes]: title } })

    relisted.current = ASKING
    await clock.advance(10_000)
    expect(sent).toEqual(['Write the 0.4 notes needs your approval'])
  })

  test('sends nothing, and shows no toast, with the notifications option off', { options: { notifications: false } }, async ($, on) => {
    const sent = notifications(on)
    const relisted = { current: undefined as unknown }
    const { clock, toasts } = await machine($, on, { listed: WORKING, relisted })

    relisted.current = ASKING
    await clock.advance(5_000)
    relisted.current = ASKING.map(s => (s.sessionId === 'd3d04fc1-full' ? { ...s, state: 'failed', status: 'idle' } : s))
    await clock.advance(5_000)
    expect(sent).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('status row', () => {
  // Beneath the plugins: the events glimt reads this session's mode from,
  // and the measurement of its limits, each answered as Claude Code would.
  function quietHooks(on: On) {
    on('classic.UserPromptSubmit', () => ({}))
    on('classic.PostToolUse', () => ({}))
    on('classic.Stop', () => ({}))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
  }
  const measure = ($: Engine, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]) =>
    $.session.measure({ context: { tokens: 0, window: 200_000, percent: 0 }, rateLimits, changed: ['rateLimits'] })
  // An hour in, 72 minutes from now.
  const RESETS = new Date(3_600_000 + 72 * 60_000).toISOString()

  test("says bypass permissions while this session's main conversation runs so, and nothing in any other mode", async ($, on) => {
    quietHooks(on)
    await machine($, on)
    const ui = await mount($)
    expect(await ui.find({ key: 'self-status' })).toBeUndefined()

    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'bypassPermissions' })
    expect(await textOf(ui, 'self-status')).toBe('bypass permissions')
    // A subagent's mode is its own.
    await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't1', permission_mode: 'plan', agent_id: 'a1' })
    expect(await textOf(ui, 'self-status')).toBe('bypass permissions')
    await $.classic.Stop({ stop_hook_active: false, permission_mode: 'plan' })
    expect(await ui.find({ key: 'self-status' })).toBeUndefined()
  })

  test('shows a limit window from 80% used, the fullest first with when it resets, at full weight from 95%', async ($, on) => {
    quietHooks(on)
    await machine($, on)
    const ui = await mount($)

    await measure($, [{ kind: 'five_hour', percentUsed: 79.9, resetsAt: RESETS }])
    expect(await ui.find({ key: 'self-status' })).toBeUndefined()
    await measure($, [
      { kind: 'seven_day', percentUsed: 80 },
      { kind: 'five_hour', percentUsed: 95, resetsAt: RESETS },
    ])
    expect(await textOf(ui, 'self-status')).toBe('5h limit 95% · resets in 1h12m · 7d limit 80%')
    const bold = (await ui.findAll({ type: 'Text' })).filter(text => text.props.bold === true).map(text => text.text)
    expect(bold.includes('5h limit 95%')).toBe(true)
    expect(bold.includes('7d limit 80%')).toBe(false)
  })

  test('on a narrow pane, shortens bypass and leaves out when a limit resets first', async ($, on) => {
    quietHooks(on)
    await machine($, on)
    const ui = await mount($, { columns: 34 })

    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'bypassPermissions' })
    await measure($, [{ kind: 'five_hour', percentUsed: 84, resetsAt: RESETS }])
    expect(await textOf(ui, 'self-status')).toBe('bypass · 5h limit 84%')
  })

  test('says same folder where another live session runs in the same folder', async ($, on) => {
    const twin = { pid: 9, cwd: '/home/demo/code', kind: 'interactive', startedAt: 0, sessionId: 'twin-full', name: 'twin', status: 'idle' }
    await machine($, on, { listed: [...LISTED, twin] })
    const ui = await mount($)

    expect(await textOf(ui, 'self-status')).toBe('same folder')
    expect(await textOf(ui, 'session-twin-full')).toBe('▸ ○ twin idle · same folder')
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle')
  })

  test('short of room, gives up a second limit window before same folder', async ($, on) => {
    quietHooks(on)
    const twin = { pid: 9, cwd: '/home/demo/code', kind: 'interactive', startedAt: 0, sessionId: 'twin-full', name: 'twin', status: 'idle' }
    await machine($, on, { listed: [...LISTED, twin] })
    const ui = await mount($, { columns: 40 })

    await measure($, [
      { kind: 'five_hour', percentUsed: 95, resetsAt: RESETS },
      { kind: 'seven_day', percentUsed: 80 },
    ])
    expect(await textOf(ui, 'self-status')).toBe('5h limit 95% · same folder')
  })

  test("marks another session's bypass permissions and a context window from 80%, as its glimt shares them", async ($, on) => {
    const share = (mode: string, context: number) => ({ at: 3_600_000, agents: [], mode, context })
    const stored = { 'agents:1879e383-full': share('bypassPermissions', 92), 'agents:a15af547-full': share('plan', 79) }
    await machine($, on, { stored })
    const wide = await mount($)
    expect(await textOf(wide, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · bypass · 92% context')
    expect(await textOf(wide, 'session-a15af547-full')).toBe('▸ ⠋ api-refactor working')
    const amber = (await wide.findAll({ type: 'Text' })).filter(text => text.props.color === 'warning').map(text => text.text)
    expect(amber.includes('bypass')).toBe(true)
    await wide.unmount()

    const narrow = await mount($, { columns: 44 })
    expect(await textOf(narrow, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · bypass · 92%')
  })

  test('short of room, gives up the agents, the plan and the time before the state, bypass and the folder', async ($, on) => {
    const twin = { pid: 9, cwd: '/home/demo/code/docs', kind: 'interactive', startedAt: 0, sessionId: 'twin-full', name: 'twin', status: 'idle' }
    const stored = {
      'agents:1879e383-full': {
        at: 3_600_000,
        agents: [{ id: 'x', type: 'Explore', description: 'look', task: '', startedAt: 3_600_000, tools: 0 }],
        plan: { done: 1, total: 4 },
        mode: 'bypassPermissions',
      },
    }
    await machine($, on, { listed: [...LISTED, twin], stored })

    const wide = await mount($, { columns: 72 })
    expect(await textOf(wide, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · bypass · same folder · 1/4 · 1 agent')
    await wide.unmount()
    const narrow = await mount($, { columns: 40 })
    // The name keeps its 8 cells; the facts take the 27 left.
    expect(await textOf(narrow, 'session-1879e383-full')).toBe('▸ ○ docs-si… idle · bypass · same folder')
  })

  test("shares this session's permission mode and context with the other sessions' glimts", async ($, on) => {
    quietHooks(on)
    loops(on)
    modelRequests(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 920_000, window: 1_000_000, percent: 92 }, rateLimits: [] } }))
    const { clock, store } = await machine($, on)
    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'acceptEdits' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await modelRequest($)

    await clock.advance(5_000)
    expect(store.get('agents:self-full')).toEqual({ at: 3_605_000, agents: [], watching: true, mode: 'acceptEdits', context: 92 })
  })

  test("going into another session names its permission mode in Claude Code's words", async ($, on) => {
    const stored = { 'agents:1879e383-full': { at: 3_600_000, agents: [], mode: 'acceptEdits' } }
    await machine($, on, { transcript: TAIL, files: [DOCS], stored })
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('○ docs-site  idle · accept edits  ⎿ ~/code/docs · terminal · 1879e383-full')
  })

  test("opened, this session's row adds the main conversation's model and effort", async ($, on) => {
    // The engine's turn.step hook is a generator; this one streams nothing.
    // oxlint-disable-next-line eslint/require-yield
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await machine($, on)
    const ui = await mount($, { isFocused: true })
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
    for await (const _chunk of stream) {
      // Read to the end, as the loop does.
    }

    await ui.press({ key: 'toggle-self' })
    expect((await textOf(ui, 'self'))?.endsWith('⎿ ~/code · Opus 5.5 · xhigh effort · ba4f4809')).toBe(true)
  })
})

describe('titles', () => {
  const titled = (...titles: string[]) =>
    `${titles.map(title => JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: '1879e383-full' })).join('\n')}\n`

  test("names a session never renamed by Claude Code's latest generated title", async ($, on) => {
    const { ran } = await machine($, on, { files: [DOCS], outputs: { [DOCS]: titled('Old title', 'Docs build fix') } })
    const ui = await mount($)

    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ Docs build fix idle')
    expect(ran.filter(argv => argv[0] === 'grep')).toEqual([['grep', '-m', '1', '-F', '"type":"custom-title"', DOCS]])
  })

  test('keeps the name of a session renamed at any point, early in its transcript or in its tail', async ($, on) => {
    const renamedLate = `${titled('Docs build fix')}${JSON.stringify({ type: 'custom-title', customTitle: 'docs-site' })}\n`
    const api = '/home/demo/.claude/projects/-srv-api/a15af547-full.jsonl'
    const { ran } = await machine($, on, {
      files: [DOCS, api],
      renamed: [DOCS],
      outputs: { [DOCS]: titled('Docs build fix'), [api]: renamedLate },
    })
    const ui = await mount($)

    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle')
    expect(await textOf(ui, 'session-a15af547-full')).toBe('▸ ⠋ api-refactor working')
    // A session found renamed is not read for a title.
    expect(ran.filter(argv => argv[0] === 'tail' && argv.at(-1) === DOCS)).toEqual([])
  })

  test('reads the title again every 30 seconds, keeping the last one when the tail holds none', LONG_CLOCK, async ($, on) => {
    const outputs: Record<string, string> = { [DOCS]: titled('First title') }
    const { clock } = await machine($, on, { files: [DOCS], outputs })
    const ui = await mount($)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ First title idle')

    outputs[DOCS] = '{"type":"user"}\n'
    await clock.advance(30_000)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ First title idle')
    outputs[DOCS] = titled('Second title')
    await clock.advance(25_000)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ First title idle')
    await clock.advance(5_000)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ Second title idle')
  })
})
