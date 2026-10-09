import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import { LONG_CLOCK, ask, finish, inAgent, loops, modelRequest, modelRequests, mount, prompts, spawn, startSession, textOf, tokens } from './kit'

describe('agents', () => {
  test('shows the main conversation first: its tool count and a clock that stops when the turn ends', LONG_CLOCK, async ($, on) => {
    const clock = mock.clock(on)
    loops(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: {} }))
    await startSession($, on)
    const ui = await mount($)

    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/x' })
    await clock.advance(5_000)
    expect(await textOf(ui, 'agent-main')).toBe('⠋ Claude main conversation <1m · 1 tool')
    expect(await textOf(ui, 'agents-heading')).toBe('Agents  1 running')

    await clock.advance(70_000)
    await $.turn.complete({ answer: '', durationMs: 75_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(30_000)
    expect(await textOf(ui, 'agent-main')).toBe('✓ Claude main conversation 1m15s · 1 tool')
  })

  test('hangs each agent under the one that spawned it, the main conversation at the root', async ($, on) => {
    mock.clock(on)
    loops(on)
    await startSession($, on)
    await $.turn.start({ text: '', turnId: 't1' })
    await spawn($, 'a1', 'one')
    await spawn($, 'a2', 'two', { parent: 'a1' })
    await spawn($, 'a3', 'three')
    await spawn($, 'a4', 'orphan', { parent: 'gone' })

    const ui = await mount($)
    expect(await textOf(ui, 'agent-main')).toBe('⠋ Claude main conversation <1m · 0 tools')
    expect(await textOf(ui, 'agent-a1')).toBe('├─ ▸ ⠋ Explore one <1m · 0 tools')
    expect(await textOf(ui, 'agent-a2')).toBe('│  └─ ▸ ⠋ Explore two <1m · 0 tools')
    expect(await textOf(ui, 'agent-a3')).toBe('├─ ▸ ⠋ Explore three <1m · 0 tools')
    expect(await textOf(ui, 'agent-a4')).toBe('└─ ▸ ⠋ Explore orphan <1m · 0 tools')
  })

  test('shows what a running call is on, a path cut from its start to fit', async ($, on) => {
    mock.clock(on)
    loops(on)
    let release = () => {}
    on('tool.call', { tool: 'Read' }, () => new Promise(resolve => (release = () => resolve({ result: {} }))))
    await spawn($, 'a1', 'read it')
    const ui = await mount($, { columns: 60 })

    const path = '/home/demo/projects/a-rather-long-folder-name/src/components/panes/register.tsx'
    const read = $.tool.call(inAgent({ tool: 'Read', file_path: path }, 'a1'))
    await ui.advance(0)
    // 60 columns less 3 of stem, 2 of "⎿ ", 4 of "Read" and 3 of " · " leave 48.
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore read it <1m · 1 tool   ⎿ Read · …g-folder-name/src/components/panes/register.tsx')
    release()
    await read
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore read it <1m · 1 tool')
  })

  test('opens an agent to show the task it was given', async ($, on) => {
    mock.clock(on)
    loops(on)
    await spawn($, 'a1', 'find loaders', { prompt: 'Find where hooks are loaded.\nReport the file and line.' })
    const ui = await mount($)

    await ui.press({ key: 'toggle-agent-a1' })
    expect(await textOf(ui, 'task-a1')).toBe('   Find where hooks are loaded.   Report the file and line.')
    expect((await textOf(ui, 'agent-a1'))?.startsWith('▾ ⠋ Explore find loaders')).toBe(true)

    await ui.press({ key: 'toggle-agent-a1' })
    expect(await ui.find({ key: 'task-a1' })).toBeUndefined()
  })

  // A main conversation and one agent, each after one model request.
  async function contextSizes($: Engine, on: On) {
    mock.clock(on)
    loops(on)
    const setUsage = modelRequests(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 740_000, window: 1_000_000, percent: 74 }, rateLimits: [] } }))
    await startSession($, on)
    await $.turn.start({ text: '', turnId: 't1' })
    await spawn($, 'a1', 'read')
    setUsage(tokens(100, 800, 40, 10))
    await modelRequest($)
    setUsage(tokens(1200, 40_000, 3000, 1000))
    await modelRequest($, 'a1')

    return setUsage
  }

  test("shows each loop's context size from its latest model request, and the main conversation's share of its window", async ($, on) => {
    await contextSizes($, on)
    const ui = await mount($)

    expect(await textOf(ui, 'agent-main')).toBe('⠋ Claude main conversation <1m · 0 tools · 950 tokens · 74% context')
    expect(await textOf(ui, 'agent-a1')).toBe('└─ ▸ ⠋ Explore read <1m · 0 tools · 45k tokens')
  })

  test('writes token counts with a decimal under ten thousand, and never rounds up to the next unit', async ($, on) => {
    const setUsage = await contextSizes($, on)
    const ui = await mount($)

    // The latest request stands: a count is a size, not a sum.
    for (const [size, shown] of [
      [999, '999'],
      [1000, '1.0k'],
      [9_949, '9.9k'],
      [9_950, '10k'],
      [999_499, '999k'],
      [999_500, '1.0M'],
    ] as const) {
      setUsage(tokens(size, 0, 0, 0))
      await modelRequest($, 'a1')
      expect(await textOf(ui, 'agent-a1')).toBe(`└─ ▸ ⠋ Explore read <1m · 0 tools · ${shown} tokens`)
    }
  })

  test('shortens the counts when the words would leave the title less than 12 cells', async ($, on) => {
    await contextSizes($, on)

    // At 50 columns the words would leave the title 7 cells: the counts
    // shorten, and the title takes the 18 left.
    const ui = await mount($, { columns: 50 })
    expect(await textOf(ui, 'agent-main')).toBe('⠋ Claude main conve… <1m · 0 tools · 950 tok · 74%')
  })

  test('short of room, drops the ⎿ lines before any running agent', async ($, on) => {
    mock.clock(on)
    loops(on)
    const releases: (() => void)[] = []
    on('tool.call', { tool: 'Bash' }, () => new Promise(resolve => releases.push(() => resolve({ result: {} }))))
    const calls = []
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await spawn($, id, id)
      calls.push($.tool.call(inAgent({ tool: 'Bash', command: 'sleep 1' }, id)))
    }
    const roomy = await mount($)
    await roomy.advance(0)
    expect(await textOf(roomy, 'agent-a1')).toBe('▸ ⠋ Explore a1 <1m · 1 tool   ⎿ Bash · sleep 1')
    await roomy.unmount()

    // 16 rows give the agents 5: the heading and four agents, but not their ⎿ lines.
    const tight = await mount($, { rows: 16 })
    expect(await textOf(tight, 'agent-a1')).toBe('▸ ⠋ Explore a1 <1m · 1 tool')
    expect(await textOf(tight, 'agent-a4')).toBe('▸ ⠋ Explore a4 <1m · 1 tool')
    expect(await tight.find({ key: 'more-agents' })).toBeUndefined()

    for (const release of releases) {
      release()
    }
    await Promise.all(calls)
  })

  test('running agents take the rows the plan and the sessions leave before any is cut', async ($, on) => {
    mock.clock(on)
    loops(on)
    for (let n = 1; n <= 12; n += 1) {
      await spawn($, `a${n}`, `agent ${n}`)
    }

    // 30 rows give the agents a share of 10, short of the 13 they need; the
    // empty plan leaves 4 more.
    const ui = await mount($, { rows: 30 })
    expect(await textOf(ui, 'agent-a12')).toBe('▸ ⠋ Explore agent 12 <1m · 0 tools')
    expect(await ui.find({ key: 'more-agents' })).toBeUndefined()
  })

  test('drops the oldest finished agents for room, then counts what is left out', async ($, on) => {
    const clock = mock.clock(on)
    loops(on)
    await startSession($, on)
    await $.turn.start({ text: '', turnId: 't1' })
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await spawn($, id, id)
      await clock.advance(1000)
      await finish($, id)
    }

    // 12 rows give the agents 4: the heading, two agents and "+3 more".
    const ui = await mount($, { rows: 12 })
    expect(await textOf(ui, 'agent-main')).toBe('⠋ Claude main conversation <1m · 0 tools')
    expect(await textOf(ui, 'agent-a4')).toBe('└─ ▸ ✓ Explore a4 1s · 0 tools')
    expect(await ui.find({ key: 'agent-a3' })).toBeUndefined()
    expect(await textOf(ui, 'more-agents')).toBe('+3 more')
  })

  test("shows a running agent's tool and count, then its result and time", LONG_CLOCK, async ($, on) => {
    const clock = mock.clock(on)
    loops(on)
    let release = () => {}
    on('tool.call', { tool: 'Bash' }, () => new Promise(resolve => (release = () => resolve({ result: {} }))))
    on('tool.call', { tool: 'Read' }, () => ({ result: {} }))
    await startSession($, on)
    await spawn($, 'a1', 'find hook loaders')
    const ui = await mount($)

    await $.tool.call(inAgent({ tool: 'Read', file_path: '/x' }, 'a1'))
    const search = $.tool.call(inAgent({ tool: 'Bash', command: 'rg register' }, 'a1'))
    await clock.advance(12_000)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find hook loaders <1m · 2 tools   ⎿ Bash · rg register')
    expect(await textOf(ui, 'agents-heading')).toBe('Agents  1 running')

    release()
    await search
    await clock.advance(52_000)
    await finish($, 'a1')
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ✓ Explore find hook loaders 1m04s · 2 tools')
    expect(await textOf(ui, 'agents-heading')).toBe('Agents')
  })

  test("spins a running agent's mark, frame by frame, and stills it once the agent is done", async ($, on) => {
    const clock = mock.clock(on)
    loops(on)
    await startSession($, on)
    await spawn($, 'a1', 'spin')
    const ui = await mount($)

    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore spin <1m · 0 tools')
    await clock.advance(100)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠙ Explore spin <1m · 0 tools')
    await finish($, 'a1')
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ✓ Explore spin 0s · 0 tools')
    expect(await textOf(ui, 'agents-heading')).toBe('Agents')
  })

  test('names an MCP tool by its own part, not the server prefix', async ($, on) => {
    mock.clock(on)
    loops(on)
    let release = () => {}
    on('tool.call', { tool: 'mcp__google-docs__read_document' }, () => new Promise(resolve => (release = () => resolve({ result: {} }))))
    await spawn($, 'a1', 'read the doc')
    const ui = await mount($)

    const read = $.tool.call(inAgent({ tool: 'mcp__google-docs__read_document' }, 'a1'))
    await ui.advance(0)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore read the doc <1m · 1 tool   ⎿ read_document')
    release()
    await read
  })

  test('marks an interrupted agent stopped and an errored one failed', async ($, on) => {
    mock.clock(on)
    loops(on)
    await spawn($, 'a1', 'interrupted')
    await spawn($, 'a2', 'errored', { type: 'general-purpose' })
    await finish($, 'a1', 'aborted')
    await finish($, 'a2', 'error')

    const ui = await mount($)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ■ Explore interrupted 0s · 0 tools')
    expect(await textOf(ui, 'agent-a2')).toBe('▸ ✗ general-purpose errored 0s · 0 tools')
  })

  test('formats times at the minute and hour edges', async ($, on) => {
    const clock = mock.clock(on)
    loops(on)
    await spawn($, 'a1', 'one')
    await spawn($, 'a2', 'two')
    await spawn($, 'a3', 'three')
    await clock.set(59_999)
    await finish($, 'a1')
    await clock.set(60_000)
    await finish($, 'a2')
    await clock.set(3_600_000)
    await finish($, 'a3')

    const ui = await mount($)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ✓ Explore one 59s · 0 tools')
    expect(await textOf(ui, 'agent-a2')).toBe('▸ ✓ Explore two 1m00s · 0 tools')
    expect(await textOf(ui, 'agent-a3')).toBe('▸ ✓ Explore three 1h00m · 0 tools')
  })

  test('a new request from the person clears finished agents and keeps running ones', async ($, on) => {
    mock.clock(on)
    loops(on)
    prompts(on)
    await spawn($, 'a1', 'finished')
    await spawn($, 'a2', 'still running')
    await finish($, 'a1')
    const ui = await mount($)

    await ask($, 'Agent "x" finished', 'task-notification')
    await ask($, '/glimt')
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ✓ Explore finished 0s · 0 tools')

    await ask($, 'Next thing')
    expect(await ui.find({ key: 'agent-a1' })).toBeUndefined()
    expect(await textOf(ui, 'agent-a2')).toBe('▸ ⠋ Explore still running <1m · 0 tools')
  })
})

describe('chat', () => {
  // A tool row as the transcript asks for it.
  function row($: Engine, tool: string, { isRunning = false, isErrored = false, input = {} } = {}) {
    return $.ui.mount({
      plugin: 'glimt',
      surface: 'terminal',
      component: 'ToolUse',
      props: { tool_use_id: `tu-${tool}`, tool, input, isRunning, isErrored, isInterrupted: false },
    })
  }

  // Beneath the plugin, the engine's own row.
  function engineRows(on: On) {
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine row</Text>
    })
  }

  const AGENT_INPUT = { subagent_type: 'Explore', description: 'find loaders', prompt: 'p' }

  test('leaves the plan rows out of the chat while the pane is drawn', async ($, on) => {
    mock.clock(on)
    engineRows(on)
    await startSession($, on)

    const plan = await row($, 'TaskCreate')
    expect(await plan.findAll({ type: 'Text' })).toEqual([])
  })

  test('squeezes a running agent to one line in the chat while the pane is drawn', async ($, on) => {
    mock.clock(on)
    engineRows(on)
    await startSession($, on)

    const agent = await row($, 'Agent', { isRunning: true, input: AGENT_INPUT })
    expect((await agent.find({ type: 'Text' }))?.text).toBe('⠋ Explore · find loaders')
  })

  test('draws the rows as usual for a finished agent or an errored plan call', async ($, on) => {
    mock.clock(on)
    engineRows(on)
    await startSession($, on)

    const agent = await row($, 'Agent', { input: AGENT_INPUT })
    expect((await agent.find({ type: 'Text' }))?.text).toBe('engine row')
    const failed = await row($, 'TaskUpdate', { isErrored: true })
    expect((await failed.find({ type: 'Text' }))?.text).toBe('engine row')
  })

  // Closes the pane as any plugin's $.ui.close does, the close mark's way in.
  const CLOSER: Plugin = {
    name: 'closer',
    register: on => {
      on('command.run', { command: 'close-glimt' }, async $ => {
        await $.ui.close({ id: 'glimt' })
        return {}
      })
    },
  }

  const PRESENTATION = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

  test('draws the rows as usual while the pane waits for room, and once it is closed', { plugins: [CLOSER] }, async ($, on) => {
    mock.clock(on)
    engineRows(on)
    on('ui.close', () => ({ value: undefined }))
    // Opened unasked on a narrow terminal it waits; /glimt places it.
    await startSession($, on, { placed: [false, true] })

    const waiting = await row($, 'TaskCreate')
    expect((await waiting.find({ type: 'Text' }))?.text).toBe('engine row')
    await waiting.unmount()

    await $.command.run({ command: 'glimt', args: '', ...PRESENTATION })
    const shown = await row($, 'TaskCreate')
    expect(await shown.findAll({ type: 'Text' })).toEqual([])
    await shown.unmount()

    await $.command.run({ command: 'close-glimt', args: '', ...PRESENTATION })
    const closed = await row($, 'TaskCreate')
    expect((await closed.find({ type: 'Text' }))?.text).toBe('engine row')
  })
})
