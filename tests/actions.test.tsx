import { describe, expect, test } from 'claude-code/testing'
import { mount, textOf } from './kit'
import { machine, onSession } from './machine'

describe('actions', () => {
  test("n opens a form for a new agent here in the footer's place; Enter starts it in the agent tree", async ($, on) => {
    const spawned: unknown[] = []
    on('agent.spawn', (_$, e) => {
      spawned.push({ prompt: e.prompt, description: e.description })
      return { model: 'claude-haiku-5-5' }
    })
    await machine($, on)
    const ui = await mount($, { isFocused: true })

    await ui.press({ key: 'key-spawn' })
    expect((await ui.find({ key: 'composer-field' }))?.props.label).toBe('New agent')
    expect(await ui.find({ key: 'keys' })).toBeUndefined()
    await ui.input({ key: 'composer-field', text: 'check the build\nthen report' })
    expect(spawned).toEqual([{ prompt: 'check the build\nthen report', description: 'check the build' }])
    expect(await ui.find({ key: 'composer' })).toBeUndefined()
    // Core alone sets a started agent's id, so the row is found by what it says.
    const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('agent-'))
    expect(rows.map(row => row.text)).toEqual(['▸ ⠋ general-purpose check the build <1m · 0 tools'])
  })

  test('passes on why a new agent did not start', async ($, on) => {
    on('agent.spawn', () => ({ deny: 'agents are off here' }))
    const { toasts } = await machine($, on)
    const ui = await mount($, { isFocused: true })

    await ui.press({ key: 'key-spawn' })
    await ui.input({ key: 'composer-field', text: 'check the build' })
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.endsWith('agents are off here')).toBe(true)
  })

  test('s in the key list opens a form for a new background session: Enter on it empty closes it, with text starts claude --bg', async ($, on) => {
    on('session.cwd', () => ({ value: '/home/demo/code' }))
    const { ran } = await machine($, on)
    const ui = await mount($, { isFocused: true })
    const starts = () => ran.filter(argv => argv[1] === '--bg')

    await ui.press({ key: 'key-help' })
    await ui.press({ key: 'help-session' })
    expect((await ui.find({ key: 'composer-field' }))?.props.label).toBe('New session')
    await ui.input({ key: 'composer-field', text: '  ' })
    expect(await ui.find({ key: 'composer' })).toBeUndefined()
    expect(starts()).toEqual([])

    await ui.press({ key: 'key-help' })
    await ui.press({ key: 'help-session' })
    await ui.input({ key: 'composer-field', text: 'tidy the notes' })
    expect(starts()).toEqual([['claude', '--bg', 'tidy the notes']])
  })

  test('r on this session renames it with /rename', async ($, on) => {
    const renamed: unknown[] = []
    on('command.run', { command: 'rename' }, (_$, e) => {
      renamed.push(e.args)
      return {}
    })
    await machine($, on)
    const ui = await mount($, { isFocused: true })
    await ui.press({ key: 'key-down' })

    await ui.press({ key: 'key-rename' })
    expect((await ui.find({ key: 'composer-field' }))?.props.label).toBe('Rename glimt work')
    await ui.input({ key: 'composer-field', text: '  mod for agents  ' })
    expect(renamed).toEqual(['mod for agents'])
  })

  test("r on another session asks its glimt through the store, and is offered only where one shares", async ($, on) => {
    const { store } = await machine($, on, { stored: { 'agents:1879e383-full': { at: 3_600_000, agents: [] } } })
    const ui = await onSession($, 1)
    expect(await ui.find({ key: 'key-rename' })).toBeUndefined()
    await ui.press({ key: 'key-down' })
    await ui.press({ key: 'key-down' })

    await ui.press({ key: 'key-rename' })
    await ui.input({ key: 'composer-field', text: 'payments' })
    expect(store.get('rename:1879e383-full')).toBe('payments')
  })

  test('takes the name another session asked of it within 5 seconds, and clears the ask', async ($, on) => {
    const renamed: unknown[] = []
    on('command.run', { command: 'rename' }, (_$, e) => {
      renamed.push(e.args)
      return {}
    })
    const { clock, store } = await machine($, on, { stored: { 'rename:self-full': 'payments' } })

    await clock.advance(5_000)
    expect(renamed).toEqual(['payments'])
    expect(store.has('rename:self-full')).toBe(false)
  })

  test('c on this session asks first: n keeps the conversation, y runs /clear', async ($, on) => {
    let cleared = 0
    on('command.run', { command: 'clear' }, () => {
      cleared += 1
      return {}
    })
    await machine($, on)
    const ui = await mount($, { isFocused: true })
    expect(await ui.find({ key: 'key-clear' })).toBeUndefined()
    await ui.press({ key: 'key-down' })

    await ui.press({ key: 'key-clear' })
    expect((await textOf(ui, 'clear-ask'))?.startsWith('Clear this conversation?')).toBe(true)
    await ui.press({ key: 'clear-no' })
    expect(await ui.find({ key: 'clear-ask' })).toBeUndefined()
    expect(cleared).toBe(0)
    await ui.press({ key: 'key-clear' })
    await ui.press({ key: 'clear-yes' })
    expect(cleared).toBe(1)
  })
})
