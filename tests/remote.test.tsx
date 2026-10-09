import { describe, expect, test } from 'claude-code/testing'
import { moveTo, textOf } from './kit'
import { AGENTS_MACHINE, DOCS, SUBAGENTS, TAIL, machine, onSession, sessionOrder } from './machine'

describe("other sessions' agents", () => {
  test('opening a session shows its agents, newest first, spinning while written to within a minute', async ($, on) => {
    await machine($, on, AGENTS_MACHINE)
    const ui = await onSession($, 3)

    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect(await textOf(ui, 'remote-1879e383-full-b1')).toBe('  ├─ ▸ ⠋ Explore find loaders <1m ago')
    expect(await textOf(ui, 'remote-1879e383-full-b3')).toBe('  ├─ ▸ ⠋ Plan plan the move 1m ago')
    expect(await textOf(ui, 'remote-1879e383-full-b2')).toBe('  └─ ▸ ○ general-purpose review the diff 1m ago')
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
  })

  test("opening one of a session's agents shows its task, from the first line of its transcript", async ($, on) => {
    const { ran } = await machine($, on, AGENTS_MACHINE)
    const ui = await onSession($, 3)
    await ui.press({ key: 'toggle-session-1879e383-full' })

    await ui.press({ key: 'toggle-remote-1879e383-full-b1' })
    expect(ran.filter(argv => argv[0] === 'head')).toEqual([['head', '-n', '1', `${SUBAGENTS}/agent-b1.jsonl`]])
    expect(await textOf(ui, 'remote-1879e383-full-b1')).toBe('  ├─ ▾ ⠋ Explore find loaders <1m ago       Find where hooks are loaded.')
  })

  test("l goes into another session's agent: its task and its activity; h steps back out one level at a time", async ($, on) => {
    await machine($, on, AGENTS_MACHINE)
    const ui = await onSession($, 3)
    const highlighted = async () => (await ui.findAll({ type: 'Text' })).filter(text => text.props.inverse === true).map(text => text.text)

    const back = async () => (await ui.find({ key: 'back' }))?.props.label

    // Into the session, onto its first agent, and into that; the way back
    // names where h goes.
    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-agents-heading')).toBe('Agents  3')
    expect(await back()).toBe('← Overview')
    // l shows once the cursor is on one of the agents.
    expect(await ui.find({ key: 'key-into' })).toBeUndefined()
    await moveTo($, 'toggle-remote-1879e383-full-b1')
    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore find loaders  <1m ago  ⎿ in docs-site')
    expect(await back()).toBe('← docs-site')
    expect(await textOf(ui, 'drill-task')).toBe('Task  Find where hooks are loaded.')
    expect(await textOf(ui, 'activity')).toBe('  ⎿ Grep · register● It is in hooks/load.ts.')

    await ui.press({ key: 'back' })
    expect(await textOf(ui, 'drill-agents-heading')).toBe('Agents  3')
    expect(await highlighted()).toEqual(['Explore find loaders'])
    await ui.press({ key: 'back' })
    expect(await highlighted()).toEqual(['docs-site'])
  })

  test("a session's glimt share marks its running agents and counts them on its row", async ($, on) => {
    const share = {
      at: 3_600_000,
      agents: [{ id: 'b2', type: 'general-purpose', description: 'review the diff', task: 'Review it.', startedAt: 3_540_000, tools: 3 }],
    }
    await machine($, on, { ...AGENTS_MACHINE, stored: { 'agents:1879e383-full': share } })
    const ui = await onSession($, 3)
    expect(await textOf(ui, 'session-1879e383-full')).toBe('▸ ○ docs-site idle · 1 agent')

    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect(await textOf(ui, 'remote-1879e383-full-b2')).toBe('  └─ ▸ ⠋ general-purpose review the diff 1m · 3 tools')
  })

  test("marks another session's agent that its glimt says waits on its person, with the tool", async ($, on) => {
    const share = {
      at: 3_600_000,
      agents: [{ id: 'b2', type: 'general-purpose', description: 'review the diff', task: '', startedAt: 3_540_000, tools: 3, asking: 'Bash' }],
    }
    await machine($, on, { ...AGENTS_MACHINE, stored: { 'agents:1879e383-full': share } })
    const ui = await onSession($, 3)

    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect(await textOf(ui, 'remote-1879e383-full-b2')).toBe('  └─ ▸ ◉ general-purpose review the diff 1m · approve Bash')
  })

  test('an opened session takes the rows the plan and agents leave, so no other session folds', async ($, on) => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `agent-c${i}.jsonl`, mtimeMs: 3_000_000 + i * 60_000 }))
    await machine($, on, { transcript: TAIL, files: [DOCS], dirs: { [SUBAGENTS]: many } })
    const ui = await onSession($, 3)

    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect(await sessionOrder(ui)).toEqual(['session-d3d04fc1-full', 'session-a15af547-full', 'session-1879e383-full'])
    expect(await ui.find({ key: 'sessions-more' })).toBeUndefined()
  })

  test('says how long ago an agent wrote by the minute: <1m below a minute, then minutes, then hours', async ($, on) => {
    const ago = (name: string, age: number) => ({ name: `agent-${name}.jsonl`, mtimeMs: 3_600_000 - age })
    const files = [ago('c1', 59_999), ago('c2', 60_000), ago('c3', 3_599_999), ago('c4', 3_600_000)]
    await machine($, on, { transcript: TAIL, files: [DOCS], dirs: { [SUBAGENTS]: files } })
    const ui = await onSession($, 3)

    await ui.press({ key: 'toggle-session-1879e383-full' })
    expect(await textOf(ui, 'remote-1879e383-full-c1')).toBe('  ├─ ▸ ⠋ Agent  <1m ago')
    expect(await textOf(ui, 'remote-1879e383-full-c2')).toBe('  ├─ ▸ ⠋ Agent  1m ago')
    expect(await textOf(ui, 'remote-1879e383-full-c3')).toBe('  ├─ ▸ ○ Agent  59m ago')
    expect(await textOf(ui, 'remote-1879e383-full-c4')).toBe('  └─ ▸ ○ Agent  1h00m ago')
  })

  test('counts the agents past the newest six as older', async ($, on) => {
    // c7 written 3 minutes ago, each before it a minute earlier.
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `agent-c${i}.jsonl`, mtimeMs: 3_000_000 + i * 60_000 }))
    await machine($, on, { transcript: TAIL, files: [DOCS], dirs: { [SUBAGENTS]: many } })
    const ui = await onSession($, 3)

    await ui.press({ key: 'toggle-session-1879e383-full' })
    // Opened, it stays on show though the room is short.
    expect((await sessionOrder(ui)).includes('session-1879e383-full')).toBe(true)
    expect(await textOf(ui, 'remote-older-1879e383-full')).toBe('  └─ +2 older')
    expect(await ui.find({ key: 'remote-1879e383-full-c1' })).toBeUndefined()
    // No meta file: its type falls back to Agent, its description to none.
    expect(await textOf(ui, 'remote-1879e383-full-c2')).toBe('  ├─ ▸ ○ Agent  8m ago')
  })
})
