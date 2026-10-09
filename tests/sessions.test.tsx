import { describe, expect, test } from 'claude-code/testing'
import { loops, mount, textOf } from './kit'
import { LISTED, DOCS, TAIL, listReads, machine, offered, onSession, sessionOrder, stops, tails } from './machine'

describe('sessions', () => {
  test('lists the other sessions under Agents: waiting first, then working, then idle', async ($, on) => {
    await machine($, on)
    const ui = await mount($)

    expect(await textOf(ui, 'sessions-heading')).toBe('Sessions  1 waiting · 1 working')
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
    expect(await textOf(ui, 'session-d3d04fc1-full')).toBe('▸ ◉ release-notes waiting · 1h00m')
    expect(await textOf(ui, 'session-a15af547-full')).toBe('▸ ⠋ api-refactor working · 1h00m')
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · 59m')
  })

  test('writes a running time by the minute: <1m below a minute, then minutes, then hours', async ($, on) => {
    const startedAgo = (age: number, id: string) => ({
      cwd: '/tmp',
      kind: 'interactive',
      startedAt: 3_600_000 - age,
      sessionId: id,
      name: id,
      status: 'idle',
    })
    await machine($, on, { listed: [startedAgo(59_999, 's1'), startedAgo(60_000, 's2'), startedAgo(3_599_999, 's3'), startedAgo(3_600_000, 's4')] })
    const ui = await mount($)

    expect(await textOf(ui, 'session-s1')).toBe('▸ ○ s1 idle · <1m')
    expect(await textOf(ui, 'session-s2')).toBe('▸ ○ s2 idle · 1m')
    expect(await textOf(ui, 'session-s3')).toBe('▸ ○ s3 idle · 59m')
    expect(await textOf(ui, 'session-s4')).toBe('▸ ○ s4 idle · 1h00m')
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
    expect(await textOf(ui, 'drill-title')).toBe('○ docs-site  idle · 59m  ⎿ ~/code/docs · terminal · 1879e383-full')
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
