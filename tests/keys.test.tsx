import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { ask, create, finish, focusRing, inAgent, loops, mount, moveTo, prompts, spawn, startSession, stepOrder, taskTools, textOf } from './kit'
import type { PaneSize } from './kit'

describe('keys', () => {
  // A pane with two steps and an agent, focused; `highlighted` reads what
  // the cursor is on.
  async function focusedPane($: Engine, on: On) {
    mock.clock(on)
    focusRing(on)
    loops(on)
    taskTools(on)
    await create($, 'one', { description: 'First step.' })
    await create($, 'two', { description: 'Second step.' })
    await spawn($, 'a1', 'helper')
    const ui = await mount($, { isFocused: true })
    const highlighted = async () => (await ui.findAll({ type: 'Text' })).filter(text => text.props.inverse === true).map(text => text.text)

    return { ui, highlighted }
  }

  test("shows only what the cursor's row allows, then n and i, while the pane holds the keyboard", async ($, on) => {
    mock.clock(on)
    focusRing(on)
    loops(on)
    await spawn($, 'a1', 'helper')
    const quiet = await mount($)
    expect(await quiet.find({ key: 'keys' })).toBeUndefined()
    await quiet.unmount()

    const focused = await mount($, { isFocused: true })
    const hotkeys = async () =>
      (await focused.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('key-') === true).map(button => button.props.hotkey)
    expect(await hotkeys()).toEqual(['n', 'i'])
    // On this session's row, c clears it; on an agent, l goes into it.
    await moveTo($, 'toggle-self')
    expect(await hotkeys()).toEqual(['c', 'n', 'i'])
    await moveTo($, 'toggle-agent-a1')
    expect(await hotkeys()).toEqual(['l', 'n', 'i'])
  })

  test('a key row that wraps takes its rows from the plan; one that just fits takes one', async ($, on) => {
    mock.clock(on)
    focusRing(on)
    taskTools(on)
    for (const subject of ['one', 'two', 'three', 'four', 'five']) {
      await create($, subject)
    }

    // On this session's row the keys take 27 cells (c: clear, n: new, i:
    // keys). At 26 columns they wrap to two rows: 19 rows less this session,
    // Now, the plan's heading, Agents, Sessions, the blanks and the three of
    // the key row leave the plan 4, for 5 steps.
    const wrapped = await mount($, { columns: 26, rows: 19, isFocused: true })
    await moveTo($, 'toggle-self')
    expect(await stepOrder(wrapped)).toEqual(['step-1', 'step-2', 'step-3'])
    expect(await textOf(wrapped, 'more')).toBe('  ☐ 2 more')
    await wrapped.unmount()

    // At 27 they just fit on one row, and the plan has 5.
    const fitting = await mount($, { columns: 27, rows: 19, isFocused: true })
    expect(await stepOrder(fitting)).toEqual(['step-1', 'step-2', 'step-3', 'step-4', 'step-5'])
  })

  test('the form closes once the pane gives up the keyboard, as Esc in its field makes it', async ($, on) => {
    const clock = mock.clock(on)
    await startSession($, on)
    const focused = await mount($, { isFocused: true })
    await focused.press({ key: 'key-spawn' })
    expect(await focused.find({ key: 'composer' })).toBeDefined()
    await focused.unmount()

    const quiet = await mount($)
    expect(await quiet.find({ key: 'composer' })).toBeUndefined()
    // The clock's next frame closes it.
    await clock.advance(100)
    await quiet.unmount()
    const again = await mount($, { isFocused: true })
    expect(await again.find({ key: 'composer' })).toBeUndefined()
  })

  test("names this session's row 'this session' until the session list names it", async ($, on) => {
    mock.clock(on)
    const ui = await mount($)

    expect(await textOf(ui, 'self')).toBe('▸ this session')
  })

  test('i shows every key under the name and where it lives, and i goes back', async ($, on) => {
    mock.clock(on)
    const ui = await mount($, { isFocused: true })

    await ui.press({ key: 'key-help' })
    expect((await textOf(ui, 'help'))?.startsWith('glimt · github.com/mmedum/glimt')).toBe(true)
    expect((await textOf(ui, 'help-keys'))?.startsWith('↑ ↓: move between rows, as Tab does')).toBe(true)
    expect(await ui.find({ key: 'plan-heading' })).toBeUndefined()
    await ui.press({ key: 'key-help' })
    expect(await textOf(ui, 'plan-heading')).toBe('Plan')
  })

  test('n in the key list opens the new-agent form and leaves the list', async ($, on) => {
    mock.clock(on)
    const ui = await mount($, { isFocused: true })

    await ui.press({ key: 'key-help' })
    await ui.press({ key: 'help-spawn' })
    expect(await ui.find({ key: 'help' })).toBeUndefined()
    expect((await ui.find({ key: 'composer-field' }))?.props.label).toBe('New agent')
  })

  test("the cursor follows Claude Code's focus ring onto a row, and stays on the row when the ring leaves the rows", async ($, on) => {
    const { highlighted } = await focusedPane($, on)
    expect(await highlighted()).toEqual([])

    await moveTo($, 'toggle-self')
    expect(await highlighted()).toEqual(['this session'])
    await moveTo($, 'toggle-2')
    expect(await highlighted()).toEqual(['two'])
    await moveTo($, 'key-spawn')
    expect(await highlighted()).toEqual(['two'])
  })

  test('q in the key list closes the pane', async ($, on) => {
    const closed: unknown[] = []
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    const { ui } = await focusedPane($, on)

    await ui.press({ key: 'key-help' })
    await ui.press({ key: 'help-close' })
    expect(closed).toEqual(['glimt'])
  })

  test('opens as a pane titled glimt', async ($, on) => {
    mock.clock(on)
    const titles: unknown[] = []
    await startSession($, on, { titles })

    expect(titles).toEqual(['glimt'])
  })

  test('/glimt opens the pane with the keyboard; at start it opens without', async ($, on) => {
    mock.clock(on)
    const askedFocus: boolean[] = []
    await startSession($, on, { askedFocus })
    await $.command.run({ command: 'glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

    expect(askedFocus).toEqual([false, true])
  })
})

describe('drill-in', () => {
  type Message = { role: 'user' | 'assistant'; text: string; toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown> }[] }

  const said = (text: string): Message => ({ role: 'assistant', text, toolUses: [] })

  // What the session holds of agent a1's conversation: its task first.
  const A1: Message[] = [
    { role: 'user', text: 'Find where hooks are loaded.', toolUses: [] },
    { role: 'assistant', text: 'Looking in the loader.', toolUses: [{ tool_use_id: 'g1', tool: 'Grep', input: { pattern: 'register' } }] },
    { role: 'user', text: '', toolUses: [] },
    said('Found it in hooks/load.ts.'),
  ]

  // Agent a1 running, its conversation `messages` (or a denial), the pane
  // focused and its cursor on a1.
  async function onAgent($: Engine, on: On, messages: Message[] | { deny: string } = A1, size: PaneSize = {}) {
    const clock = mock.clock(on)
    focusRing(on)
    loops(on)
    on('session.messages', (_$, e) => ({ value: e.agentId === 'a1' ? messages : { deny: `no agent ${e.agentId}` } }))
    await spawn($, 'a1', 'find loaders', { prompt: 'Find where hooks are loaded.' })
    const ui = await mount($, { isFocused: true, ...size })
    await moveTo($, 'toggle-agent-a1')
    const highlighted = async () => (await ui.findAll({ type: 'Text' })).filter(text => text.props.inverse === true).map(text => text.text)

    return { ui, clock, highlighted }
  }

  test('l goes into an agent: its task and its activity; h comes back to the row it left', async ($, on) => {
    const { ui, highlighted } = await onAgent($, on)

    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore find loaders  <1m · 0 tools · Haiku 5.5')
    expect(await textOf(ui, 'drill-task')).toBe('Task  Find where hooks are loaded.')
    // The task is not repeated as the first activity.
    expect(await textOf(ui, 'activity')).toBe('● Looking in the loader.  ⎿ Grep · register● Found it in hooks/load.ts.')
    expect(await ui.find({ key: 'agents-heading' })).toBeUndefined()
    // h is the way back's own key, named where it goes.
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('h')
    expect(await textOf(ui, 'back')).toBe('← Overview')

    await ui.press({ key: 'back' })
    expect(await textOf(ui, 'agents-heading')).toBe('Agents  1 running')
    expect(await highlighted()).toEqual(['Explore find loaders'])
  })

  test('follows the agent as it works: its running call, and its activity after each call', async ($, on) => {
    const messages = [...A1]
    let release = () => {}
    on('tool.call', { tool: 'Bash' }, () => new Promise(resolve => (release = () => resolve({ result: {} }))))
    const { ui } = await onAgent($, on, messages)
    await ui.press({ key: 'key-into' })

    const call = $.tool.call(inAgent({ tool: 'Bash', command: 'rg register hooks/' }, 'a1'))
    await ui.advance(0)
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore find loaders  <1m · 1 tool · Haiku 5.5  ⎿ Bash · rg register hooks/')

    messages.push(said('The loader is in load.ts:42.'))
    release()
    await call
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore find loaders  <1m · 1 tool · Haiku 5.5')
    expect((await textOf(ui, 'activity'))?.endsWith('● The loader is in load.ts:42.')).toBe(true)
  })

  test("says why an agent's activity cannot be read", async ($, on) => {
    const { ui } = await onAgent($, on, { deny: 'agent a1 runs in another process' })

    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'activity')).toBe('agent a1 runs in another process')
  })

  test('fits the activity to the rows left, keeping the newest', async ($, on) => {
    // 17 rows less 13 (the way back, the title and its line, the task under
    // its heading, the activity's heading, the message field, the keys and
    // the blanks) leave the activity 4.
    const { ui } = await onAgent($, on, ['one', 'two', 'three', 'four', 'five', 'six'].map(said), { rows: 17 })

    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'activity')).toBe('● three● four● five● six')
  })

  test('the message field sends to the agent the pane is in', async ($, on) => {
    const sent: unknown[] = []
    on('session.send', (_$, e) => {
      sent.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })
    const { ui } = await onAgent($, on)
    await ui.press({ key: 'key-into' })

    await ui.input({ key: 'message-field', text: 'stop after this file' })
    expect(sent).toEqual([{ to: 'a1', text: 'stop after this file' }])
  })

  test('says so once the agent it is in is cleared away', async ($, on) => {
    prompts(on)
    const { ui } = await onAgent($, on)
    await ui.press({ key: 'key-into' })

    await finish($, 'a1')
    await ask($, 'Next thing')
    expect(await textOf(ui, 'drill-title')).toBe('This agent is no longer listed.')
  })
})
