import { describe, expect, test } from 'claude-code/testing'
import { ask, create, loops, mount, moveTo, promptBox, prompts, setStatus, spawn, taskTools, textOf, typeInPrompt } from './kit'
import { LISTED, machine, sessionOrder } from './machine'

describe('sharing between sessions', () => {
  test("shares this session's running agents for the other sessions' glimts, unchanged again only every 30 seconds", async ($, on) => {
    loops(on)
    const { clock, store } = await machine($, on)
    await spawn($, 'a1', 'find loaders', { prompt: 'Find where hooks are loaded.' })
    const sharedAt = () => {
      const share = store.get('agents:self-full')
      return typeof share === 'object' && share !== null && 'at' in share ? share.at : undefined
    }

    await clock.advance(5_000)
    expect(store.get('agents:self-full')).toEqual({
      at: 3_605_000,
      agents: [{ id: 'a1', type: 'Explore', description: 'find loaders', task: 'Find where hooks are loaded.', startedAt: 3_600_000, tools: 0 }],
      watching: true,
    })
    await clock.advance(25_000)
    expect(sharedAt()).toBe(3_605_000)
    await clock.advance(5_000)
    expect(sharedAt()).toBe(3_635_000)
  })

  test("shares how far this session's plan has come", async ($, on) => {
    taskTools(on)
    const { clock, store } = await machine($, on)
    await create($, 'one')
    await create($, 'two')
    await create($, 'three')
    await setStatus($, '1', 'completed')
    await setStatus($, '2', 'in_progress')

    await clock.advance(5_000)
    expect(store.get('agents:self-full')).toEqual({ at: 3_605_000, agents: [], plan: { done: 1, total: 3 }, watching: true })
  })

  test("shows how far another session's plan has come on its row", async ($, on) => {
    await machine($, on, { stored: { 'agents:1879e383-full': { at: 3_600_000, agents: [], plan: { done: 2, total: 5 } } } })
    const ui = await mount($)

    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · 2/5')
  })

  test('shows a share a minute old, and none older', async ($, on) => {
    const share = (at: number) => ({ at, agents: [{ id: 'x1', type: 'Explore', description: 'look', task: '', startedAt: at, tools: 0 }] })
    await machine($, on, { stored: { 'agents:1879e383-full': share(3_540_000), 'agents:a15af547-full': share(3_539_999) } })
    const ui = await mount($)

    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · 1 agent')
    expect(await textOf(ui, 'session-a15af547-full')).toBe('▸ ⠋ api-refactor working')
  })

  test("clears away what sessions no longer listed shared or were asked, and keeps this session's own though it is not listed yet", async ($, on) => {
    // As just after a /clear: this session's new id is not in the list yet.
    const { store } = await machine($, on, {
      listed: LISTED.filter(s => s.sessionId !== 'self-full'),
      stored: {
        'agents:gone': { at: 3_600_000, agents: [] },
        'rename:gone': 'old',
        'agents:self-full': { at: 3_600_000, agents: [] },
        'notes:gone': 1,
      },
    })

    expect([...store.keys()]).toEqual(['agents:self-full', 'notes:gone'])
  })

  test("/clear takes this session's share away", async ($, on) => {
    on('session.end', () => ({ sessionId: 'self-full' }))
    const { store } = await machine($, on, { stored: { 'agents:self-full': { at: 3_600_000, agents: [] } } })

    await $.session.end({ reason: 'clear', sessionId: 'self-full', resume: { id: 'self-full' } })
    expect(store.has('agents:self-full')).toBe(false)
  })

  test('after /clear it learns its new id: the new conversation stands at the top, not among the others', async ($, on) => {
    on('classic.SessionStart', () => ({}))
    const selfId = { current: 'self-full' }
    const listed: object[] = [...LISTED]
    await machine($, on, { listed, selfId })
    const ui = await mount($)
    expect(await textOf(ui, 'self')).toBe('▸ glimt work  this session')

    selfId.current = 'new-full'
    listed[2] = { ...LISTED[2], sessionId: 'new-full', name: 'After clear' }
    await $.classic.SessionStart({ source: 'clear' })
    expect(await textOf(ui, 'self')).toBe('▸ After clear  this session')
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
  })

  // What this session's share says of the person's reactions.
  const seenShared = (store: Map<string, unknown>) => {
    const share = store.get('agents:self-full')
    return typeof share === 'object' && share !== null && 'seen' in share ? share.seen : undefined
  }

  test('shares when its person last typed in the prompt box, and never what', async ($, on) => {
    promptBox(on)
    const { clock, store } = await machine($, on)

    await clock.advance(1_000)
    await typeInPrompt($, 'deploy to', ' prod')
    await clock.advance(4_000)
    expect(store.get('agents:self-full')).toEqual({ at: 3_605_000, agents: [], watching: true, seen: { 'self-full': 3_601_000 } })
  })

  test('shares when its person last sent a prompt, a slash command too, and not when a task notification came in', async ($, on) => {
    prompts(on)
    const { clock, store } = await machine($, on)

    await clock.advance(1_000)
    await ask($, '/compact')
    await clock.advance(1_000)
    await ask($, 'agent a1 finished', 'task-notification')
    await clock.advance(3_000)
    expect(seenShared(store)).toEqual({ 'self-full': 3_601_000 })
  })

  test('shares when its person last pressed in its pane', async ($, on) => {
    const { clock, store } = await machine($, on)
    const ui = await mount($)

    await clock.advance(3_000)
    await ui.press({ key: 'toggle-self' })
    await clock.advance(2_000)
    expect(seenShared(store)).toEqual({ 'self-full': 3_603_000 })
  })

  test('shares when its person last moved in its pane', async ($, on) => {
    const { clock, store } = await machine($, on)
    await mount($, { isFocused: true })

    await clock.advance(2_000)
    await moveTo($, 'toggle-self')
    await clock.advance(3_000)
    expect(seenShared(store)).toEqual({ 'self-full': 3_602_000 })
  })

  test("passes on what another glimt shared of the person's reactions, for listed sessions only", async ($, on) => {
    const { clock, store } = await machine($, on, {
      stored: { 'agents:a15af547-full': { at: 3_600_000, agents: [], seen: { '1879e383-full': 3_590_000, 'gone-full': 3_580_000 } } },
    })
    await mount($)

    await clock.advance(5_000)
    expect(seenShared(store)).toEqual({ '1879e383-full': 3_590_000 })
  })

  test('shares a session opened here', async ($, on) => {
    const { clock, store } = await machine($, on)
    const ui = await mount($)

    await clock.advance(1_000)
    await ui.press({ key: 'toggle-session-1879e383-full' })
    await clock.advance(4_000)
    expect(seenShared(store)).toEqual({ 'self-full': 3_601_000, '1879e383-full': 3_601_000 })
  })
})
