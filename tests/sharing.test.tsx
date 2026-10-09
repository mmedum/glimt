import { describe, expect, test } from 'claude-code/testing'
import { loops, mount, spawn, textOf } from './kit'
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
    })
    await clock.advance(25_000)
    expect(sharedAt()).toBe(3_605_000)
    await clock.advance(5_000)
    expect(sharedAt()).toBe(3_635_000)
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
})
