import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { LONG_CLOCK, loops, mount, textOf } from './kit'
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
      cwd: '/tmp',
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
    await ui.press({ key: 'key-open' })
    expect(await isBold()).toBe(false)

    // It works again, and stops again: bold until l goes into it.
    await ui.press({ key: 'key-open' })
    relisted.current = DOCS_BUSY
    await clock.advance(5_000)
    expect(await isBold()).toBe(false)
    relisted.current = LISTED
    await clock.advance(5_000)
    expect(await isBold()).toBe(true)
    await ui.press({ key: 'key-into' })
    await ui.press({ key: 'key-back' })
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
    const idleToo = { pid: 1, cwd: '/tmp', kind: 'interactive', startedAt: 0, sessionId: 'idle-2', name: 'second idle', status: 'idle' }
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
    await background.press({ key: 'key-down' })
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

  test('an opened session shows its folder, kind and id', async ($, on) => {
    await machine($, on)
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-open' })
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

    await ui.press({ key: 'key-back' })
    expect(await textOf(ui, 'sessions-heading')).toBe('Sessions  1 waiting · 1 working')
  })

  test("reads a session's transcript again every 2 seconds while the pane is in it, and stops on the way out", async ($, on) => {
    const { ran, clock } = await machine($, on, { transcript: TAIL, files: [DOCS] })
    const ui = await onSession($, 3)
    await ui.press({ key: 'key-into' })

    await clock.advance(4_000)
    expect(tails(ran).length).toBe(3)
    await ui.press({ key: 'key-back' })
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
})
