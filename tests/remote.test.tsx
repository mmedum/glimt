import { describe, expect, test } from 'claude-code/testing'
import { textOf } from './kit'
import { AGENTS_MACHINE, DOCS, SUBAGENTS, TAIL, machine, onSession, sessionOrder } from './machine'

describe("other sessions' agents", () => {
  test("o opens a session onto its agents, newest first, spinning while written to within a minute", async ($, on) => {
    await machine($, on, AGENTS_MACHINE)
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-open' })
    expect(await textOf(ui, 'remote-1879e383-full-b1')).toBe('  ├─ ▸ ⠋ Explore find loaders <1m ago')
    expect(await textOf(ui, 'remote-1879e383-full-b3')).toBe('  ├─ ▸ ⠋ Plan plan the move 1m ago')
    expect(await textOf(ui, 'remote-1879e383-full-b2')).toBe('  └─ ▸ ○ general-purpose review the diff 1m ago')
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
  })

  test("j walks onto a session's agents and o opens one's task, from the first line of its transcript", async ($, on) => {
    const { ran } = await machine($, on, AGENTS_MACHINE)
    const ui = await onSession($, 3)
    await ui.press({ key: 'key-open' })

    await ui.press({ key: 'key-down' })
    await ui.press({ key: 'key-open' })
    expect(ran.filter(argv => argv[0] === 'head')).toEqual([['head', '-n', '1', `${SUBAGENTS}/agent-b1.jsonl`]])
    expect(await textOf(ui, 'remote-1879e383-full-b1')).toBe('  ├─ ▾ ⠋ Explore find loaders <1m ago       Find where hooks are loaded.')
  })

  test("l goes into another session's agent: its task and its activity; h steps back out one level at a time", async ($, on) => {
    await machine($, on, AGENTS_MACHINE)
    const ui = await onSession($, 3)
    const highlighted = async () =>
      (await ui.findAll({ type: 'Text' })).filter(text => text.props.inverse === true).map(text => text.text)

    // Into the session, onto its first agent, and into that.
    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-agents-heading')).toBe('Agents  3')
    await ui.press({ key: 'key-down' })
    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore find loaders  <1m ago  ⎿ in docs-site')
    expect(await textOf(ui, 'drill-task')).toBe('Task  Find where hooks are loaded.')
    expect(await textOf(ui, 'activity')).toBe('  ⎿ Grep · register● It is in hooks/load.ts.')

    await ui.press({ key: 'key-back' })
    expect(await textOf(ui, 'drill-agents-heading')).toBe('Agents  3')
    expect(await highlighted()).toEqual(['Explore find loaders'])
    await ui.press({ key: 'key-back' })
    expect(await highlighted()).toEqual(['docs-site'])
  })

  test("a session's glimt share marks its running agents and counts them on its row", async ($, on) => {
    const share = { at: 3_600_000, agents: [{ id: 'b2', type: 'general-purpose', description: 'review the diff', task: 'Review it.', startedAt: 3_540_000, tools: 3 }] }
    await machine($, on, { ...AGENTS_MACHINE, stored: { 'agents:1879e383-full': share } })
    const ui = await onSession($, 3)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · 59m · 1 agent')

    await ui.press({ key: 'key-open' })
    expect(await textOf(ui, 'remote-1879e383-full-b2')).toBe('  └─ ▸ ⠋ general-purpose review the diff 1m · 3 tools')
  })

  test('an opened session takes the rows the plan and agents leave, so no other session folds', async ($, on) => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `agent-c${i}.jsonl`, mtimeMs: 3_000_000 + i * 60_000 }))
    await machine($, on, { transcript: TAIL, files: [DOCS], dirs: { [SUBAGENTS]: many } })
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-open' })
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
    expect(await ui.find({ key: 'sessions-more' })).toBeUndefined()
  })

  test('counts the agents past the newest six as older', async ($, on) => {
    // c7 written 3 minutes ago, each before it a minute earlier.
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `agent-c${i}.jsonl`, mtimeMs: 3_000_000 + i * 60_000 }))
    await machine($, on, { transcript: TAIL, files: [DOCS], dirs: { [SUBAGENTS]: many } })
    const ui = await onSession($, 3)

    await ui.press({ key: 'key-open' })
    // Opened, it stays on show though the room is short.
    expect((await sessionOrder(ui)).includes('session-1879e383-full')).toBe(true)
    expect(await textOf(ui, 'remote-older-1879e383-full')).toBe('  └─ +2 older')
    expect(await ui.find({ key: 'remote-1879e383-full-c1' })).toBeUndefined()
    // No meta file: its type falls back to Agent, its description to none.
    expect(await textOf(ui, 'remote-1879e383-full-c2')).toBe('  ├─ ▸ ○ Agent  8m ago')
  })
})
