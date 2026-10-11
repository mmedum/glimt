import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import {
  CLOSER,
  ask,
  create,
  finish,
  focusRing,
  inAgent,
  loops,
  mount,
  moveTo,
  prompts,
  setFocus,
  spawn,
  startSession,
  stepOrder,
  taskTools,
  textOf,
} from './kit'
import type { Mounted, PaneSize } from './kit'
import { AGENTS_MACHINE, machine } from './machine'

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

  test('keeps a form opened once the pane got the keyboard back before the next frame', async ($, on) => {
    const clock = mock.clock(on)
    await startSession($, on)
    const ui = await mount($, { isFocused: true })

    await setFocus(ui, false)
    await setFocus(ui, true)
    await ui.press({ key: 'key-spawn' })
    await clock.advance(100)
    expect(await ui.find({ key: 'composer' })).toBeDefined()
  })

  test('keeps a form open in the terminal while another surface draws the pane without the keyboard', async ($, on) => {
    const clock = mock.clock(on)
    await startSession($, on)
    const terminal = await mount($, { isFocused: true })
    await terminal.press({ key: 'key-spawn' })

    await mount($, { surface: 'desktop' })
    await clock.advance(100)
    expect(await terminal.find({ key: 'composer' })).toBeDefined()
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

  // Claude Code's record of glimt's pane, as $.ui.panes lists it.
  const glimtPane = (isShown: boolean) => [{ id: 'glimt', title: 'glimt', isShown, isFocused: false, isPlaced: true }]

  test('/glimt closes the pane when it is the one shown', async ($, on) => {
    mock.clock(on)
    const closed: unknown[] = []
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    on('ui.panes', () => ({ value: glimtPane(true) }))
    const askedFocus: boolean[] = []
    await startSession($, on, { askedFocus })
    await $.command.run({ command: 'glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

    expect(closed).toEqual(['glimt'])
    expect(askedFocus).toEqual([false])
  })

  test('/glimt brings the pane to the front with the keyboard when another pane is shown over it', async ($, on) => {
    mock.clock(on)
    const closed: unknown[] = []
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    on('ui.panes', () => ({ value: glimtPane(false) }))
    const askedFocus: boolean[] = []
    await startSession($, on, { askedFocus })
    await $.command.run({ command: 'glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

    expect(closed).toEqual([])
    expect(askedFocus).toEqual([false, true])
  })

  test('a pane the person closed stays closed after /clear, until /glimt opens it', async ($, on) => {
    mock.clock(on)
    on('ui.close', () => ({ value: undefined }))
    on('classic.SessionStart', () => ({}))
    const askedFocus: boolean[] = []
    await startSession($, on, { askedFocus })
    const ui = await mount($, { isFocused: true })

    await ui.press({ key: 'key-help' })
    await ui.press({ key: 'help-close' })
    await $.classic.SessionStart({ source: 'clear' })
    expect(askedFocus).toEqual([false])

    await $.command.run({ command: 'glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await $.classic.SessionStart({ source: 'clear' })
    expect(askedFocus).toEqual([false, true, false])
  })
})

describe('the cursor row', () => {
  // A row of each kind the cursor can be on: this session, a step, an agent,
  // another session, and one of that session's agents. `name` is what is
  // inverse while the pane holds the keyboard, `line` the row the band runs
  // across without it.
  const ROWS = [
    { toggle: 'toggle-self', name: 'glimt work', line: '▸ glimt work  this session' },
    { toggle: 'toggle-1', name: 'Write the pane', line: '▸ ☐ Write the pane' },
    { toggle: 'toggle-agent-a1', name: 'Explore helper', line: '▸ ⠋ Explore helper <1m · 0 tools' },
    { toggle: 'toggle-session-d3d04fc1-full', name: 'release-notes', line: '▸ ◉ release-notes waiting' },
    { toggle: 'toggle-remote-1879e383-full-b1', name: 'Explore find loaders', line: '  ├─ ▸ ⠋ Explore find loaders <1m ago' },
  ]

  // The pane holding the keyboard, with every row in ROWS: docs-site is
  // opened to show its agents.
  async function everyRow($: Engine, on: On) {
    taskTools(on)
    loops(on)
    await machine($, on, AGENTS_MACHINE)
    await create($, 'Write the pane')
    await spawn($, 'a1', 'helper')
    const ui = await mount($, { isFocused: true })
    await ui.press({ key: 'toggle-session-1879e383-full' })

    return ui
  }

  // Each element the pane marks: a text drawn inverse, or one on a band of
  // background color, a row's or a text's.
  const marks = async (ui: Mounted) =>
    [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Box' }))]
      .filter(one => one.props.inverse === true || one.props.backgroundColor !== undefined)
      .map(one => ({ type: one.type, text: one.text, inverse: one.props.inverse === true, band: one.props.backgroundColor }))

  const inverse = (text: string) => [{ type: 'Text', text, inverse: true, band: undefined }]
  const band = (text: string, color: string) => [{ type: 'Box', text, inverse: false, band: color }]

  test('is inverse on the name while the pane holds the keyboard', async ($, on) => {
    const ui = await everyRow($, on)

    for (const row of ROWS) {
      await moveTo($, row.toggle)
      expect(await marks(ui)).toEqual(inverse(row.name))
    }
  })

  test("keeps a quiet band across the row, the theme's background for your messages, once Esc gives the keyboard back to the prompt", async ($, on) => {
    const ui = await everyRow($, on)

    for (const row of ROWS) {
      await setFocus(ui, true)
      await moveTo($, row.toggle)
      await setFocus(ui, false)
      expect(await marks(ui)).toEqual(band(row.line, 'userMessageBackground'))
    }
  })

  test('draws the band in the Cursor band color option', { options: { bandColor: '#3b4261' } }, async ($, on) => {
    const ui = await everyRow($, on)

    for (const row of ROWS) {
      await setFocus(ui, true)
      await moveTo($, row.toggle)
      await setFocus(ui, false)
      expect(await marks(ui)).toEqual(band(row.line, '#3b4261'))
    }
  })

  test(
    "draws the band in the theme's background for your messages for a Cursor band color glimt can't read",
    { options: { bandColor: 'teal' } },
    async ($, on) => {
      const ui = await everyRow($, on)

      await moveTo($, 'toggle-1')
      await setFocus(ui, false)
      expect(await marks(ui)).toEqual(band('▸ ☐ Write the pane', 'userMessageBackground'))
    },
  )

  test('is inverse again when the pane gets the keyboard back', async ($, on) => {
    const ui = await everyRow($, on)

    for (const row of ROWS) {
      await moveTo($, row.toggle)
      await setFocus(ui, false)
      await setFocus(ui, true)
      expect(await marks(ui)).toEqual(inverse(row.name))
    }
  })

  test("keeps the band while a form's field holds the keyboard: a new agent's task, or a new name", async ($, on) => {
    const ui = await everyRow($, on)
    await moveTo($, 'toggle-self')

    await ui.press({ key: 'key-spawn' })
    expect(await marks(ui)).toEqual(band('▸ glimt work  this session', 'userMessageBackground'))
    await ui.press({ key: 'composer-cancel' })
    await ui.press({ key: 'key-rename' })
    expect(await marks(ui)).toEqual(band('▸ glimt work  this session', 'userMessageBackground'))
  })

  // A bug found in review: with Tab or a click on the form's field before
  // Enter, the row kept the band after the form closed.
  test('is inverse again once the form closes on Enter, also after Tab put the ring on its field', async ($, on) => {
    const ui = await everyRow($, on)
    await moveTo($, 'toggle-self')

    await ui.press({ key: 'key-rename' })
    await moveTo($, 'composer-field')
    await ui.input({ key: 'composer-field', text: 'docs work' })
    expect(await ui.find({ key: 'composer' })).toBeUndefined()
    expect(await marks(ui)).toEqual(inverse('glimt work'))
  })

  test('forgets the cursor when the pane closes, by its close mark or by q: opened again, no row is marked', { plugins: [CLOSER] }, async ($, on) => {
    on('ui.close', () => ({ value: undefined }))
    const ui = await everyRow($, on)
    await moveTo($, 'toggle-1')

    await $.command.run({ command: 'close-glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await ui.unmount()
    const reopened = await mount($)
    expect(await marks(reopened)).toEqual([])
    await reopened.unmount()

    const again = await mount($, { isFocused: true })
    await moveTo($, 'toggle-1')
    await again.press({ key: 'key-help' })
    await again.press({ key: 'help-close' })
    await again.unmount()
    expect(await marks(await mount($))).toEqual([])
  })

  test('keeps everything as it was when a hook refuses the close from its close mark', { plugins: [CLOSER] }, async ($, on) => {
    on('ui.close', () => ({ deny: 'kept open' }))
    const ui = await everyRow($, on)
    await moveTo($, 'toggle-1')

    await $.command
      .run({ command: 'close-glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
      .catch(() => undefined)
    await setFocus(ui, false)
    expect(await marks(ui)).toEqual(band('▸ ☐ Write the pane', 'userMessageBackground'))
  })

  test('forgets the key list, and a clear or a stop waiting for y or n, when the pane closes', { plugins: [CLOSER] }, async ($, on) => {
    on('ui.close', () => ({ value: undefined }))
    const first = await everyRow($, on)
    const reopen = async (pane: Mounted) => {
      await $.command.run({ command: 'close-glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
      await pane.unmount()
      return mount($, { isFocused: true })
    }

    await first.press({ key: 'key-help' })
    const second = await reopen(first)
    expect(await second.find({ key: 'help' })).toBeUndefined()

    await moveTo($, 'toggle-self')
    await second.press({ key: 'key-clear' })
    expect(await second.find({ key: 'clear-ask' })).toBeDefined()
    const third = await reopen(second)
    expect(await third.find({ key: 'clear-ask' })).toBeUndefined()

    await moveTo($, 'toggle-session-d3d04fc1-full')
    await third.press({ key: 'key-stop' })
    expect(await third.find({ key: 'stop-d3d04fc1-full' })).toBeDefined()
    const fourth = await reopen(third)
    expect(await fourth.find({ key: 'stop-d3d04fc1-full' })).toBeUndefined()
  })

  test('keeps everything as it was, the key list too, when a hook refuses the close q asks for', async ($, on) => {
    on('ui.close', () => ({ deny: 'kept open' }))
    const ui = await everyRow($, on)
    await moveTo($, 'toggle-1')

    await ui.press({ key: 'key-help' })
    await ui.press({ key: 'help-close' })
    expect(await ui.find({ key: 'help' })).toBeDefined()
    await ui.press({ key: 'key-help' })
    await setFocus(ui, false)
    expect(await marks(ui)).toEqual(band('▸ ☐ Write the pane', 'userMessageBackground'))
  })

  test('opens on the overview again after it closed inside a session', { plugins: [CLOSER] }, async ($, on) => {
    on('ui.close', () => ({ value: undefined }))
    const ui = await everyRow($, on)
    await moveTo($, 'toggle-session-1879e383-full')
    await ui.press({ key: 'key-into' })
    expect(await ui.find({ key: 'drill' })).toBeDefined()

    await $.command.run({ command: 'close-glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await ui.unmount()
    const reopened = await mount($, { isFocused: true })
    expect(await reopened.find({ key: 'drill' })).toBeUndefined()
    expect(await textOf(reopened, 'sessions-heading')).toBe('Sessions  1 waiting · 1 working')
  })

  test('closes a form left open when the pane closes: opened again, it does not come back', { plugins: [CLOSER] }, async ($, on) => {
    on('ui.close', () => ({ value: undefined }))
    const ui = await everyRow($, on)
    await ui.press({ key: 'key-spawn' })
    expect(await ui.find({ key: 'composer' })).toBeDefined()

    await $.command.run({ command: 'close-glimt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await ui.unmount()
    const reopened = await mount($, { isFocused: true })
    expect(await reopened.find({ key: 'composer' })).toBeUndefined()
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
