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

describe('waiting on approval', () => {
  // A session whose Bash calls run until released, its pane's clock ticking.
  async function asking($: Engine, on: On) {
    const clock = mock.clock(on)
    loops(on)
    // Beneath the plugins, the request goes on to the person's dialog.
    on('classic.PermissionRequest', () => ({}))
    modelRequests(on)
    const releases: (() => void)[] = []
    on('tool.call', { tool: 'Bash' }, () => new Promise(resolve => releases.push(() => resolve({ result: {} }))))
    const stored = new Map<string, unknown>()
    on('store.set', (_$, e) => {
      stored.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.get', () => ({ value: undefined }))
    on('store.keys', () => ({ value: [] }))
    on('session.id', () => ({ value: 'self-full' }))
    await startSession($, on)
    // Claude Code about to ask the person about an agent's call, as a
    // session raises it while the call waits.
    const check = (agentId: string, command: string) => $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command }, agent_id: agentId })

    return { clock, stored, check, releases, release: () => releases.forEach(release => release()) }
  }

  test('marks an agent waiting once a call of its has waited a second on its person, until the call ends', async ($, on) => {
    const { clock, check, release } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    const call = $.tool.call(inAgent({ tool: 'Bash', command: 'npm test' }, 'a1'))
    await check('a1', 'npm test')
    await clock.advance(999)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠏ Explore find loaders <1m · 1 tool   ⎿ Bash · npm test')

    await clock.advance(1)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 1 tool   ⎿ approve Bash · npm test')
    expect(await textOf(ui, 'agents-heading')).toBe('Agents  1 running · 1 waiting')

    release()
    await call
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find loaders <1m · 1 tool')
    expect(await textOf(ui, 'agents-heading')).toBe('Agents  1 running')
  })

  // The directory's rule: a mod leaves every permission decision to the person.
  test('hands a permission request on exactly as it came, for the person to answer', async ($, on) => {
    mock.clock(on)
    loops(on)
    const reached: unknown[] = []
    on('classic.PermissionRequest', (_$, e) => {
      reached.push(e)
      return { decision: { behavior: 'deny' as const, message: 'not now' } }
    })
    await spawn($, 'a1', 'find loaders')

    const raised = {
      tool_name: 'Bash',
      tool_input: { command: 'git push' },
      agent_id: 'a1',
      permission_suggestions: [
        {
          type: 'addRules' as const,
          rules: [{ toolName: 'Bash', ruleContent: 'git push' }],
          behavior: 'allow' as const,
          destination: 'session' as const,
        },
      ],
    }
    const answer = await $.classic.PermissionRequest(raised)
    expect(reached.length).toBe(1)
    expect(reached[0]).toMatchObject(raised)
    expect(answer).toEqual({ decision: { behavior: 'deny', message: 'not now' } })
  })

  test('leaves an agent alone when the main conversation, or another agent, is asked', async ($, on) => {
    const { clock, release } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    await spawn($, 'a2', 'review the diff')
    const ui = await mount($)
    const call = $.tool.call(inAgent({ tool: 'Bash', command: 'npm test' }, 'a1'))
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' }, agent_id: 'a2' })
    await clock.advance(2_000)

    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find loaders <1m · 1 tool   ⎿ Bash · npm test')
    release()
    await call
  })

  test('keeps waiting while the asked call runs, though another call of the same tool ends', async ($, on) => {
    const { clock, check, releases } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    const list = $.tool.call(inAgent({ tool: 'Bash', command: 'ls' }, 'a1'))
    const push = $.tool.call(inAgent({ tool: 'Bash', command: 'git push' }, 'a1'))
    await check('a1', 'git push')
    await clock.advance(1_000)

    // ls ends first; git push still waits on its person.
    releases[0]?.()
    await list
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 2 tools   ⎿ approve Bash · git push')
    releases[1]?.()
    await push
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find loaders <1m · 2 tools')
  })

  test('marks the call even when a hook changed what it runs before Claude Code asks', async ($, on) => {
    const { clock, check, release } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    const call = $.tool.call(inAgent({ tool: 'Bash', command: 'git status' }, 'a1'))
    await check('a1', 'rtk git status')
    await clock.advance(1_000)

    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 1 tool   ⎿ approve Bash · git status')
    release()
    await call
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find loaders <1m · 1 tool')
  })

  test('keeps waiting while one of two asked calls is still open', async ($, on) => {
    const { clock, check, releases } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    const first = $.tool.call(inAgent({ tool: 'Bash', command: 'git push' }, 'a1'))
    const second = $.tool.call(inAgent({ tool: 'Bash', command: 'npm publish' }, 'a1'))
    await check('a1', 'git push')
    await clock.advance(500)
    await check('a1', 'npm publish')
    await clock.advance(500)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 2 tools   ⎿ approve Bash · git push')

    // The first is answered and ends; the second has waited a second too.
    releases[0]?.()
    await first
    await clock.advance(500)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 2 tools   ⎿ approve Bash · npm publish')
    releases[1]?.()
    await second
  })

  test('two identical calls both asked: when one ends, the other still waits', async ($, on) => {
    const { clock, check, releases } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    const first = $.tool.call(inAgent({ tool: 'Bash', command: 'git push' }, 'a1'))
    const second = $.tool.call(inAgent({ tool: 'Bash', command: 'git push' }, 'a1'))
    await check('a1', 'git push')
    await check('a1', 'git push')
    await clock.advance(1_000)

    releases[0]?.()
    await first
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 2 tools   ⎿ approve Bash · git push')
    releases[1]?.()
    await second
  })

  test("drops an agent's calls as its next model request starts, should one never tell its end", async ($, on) => {
    const { clock, check } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    void $.tool.call(inAgent({ tool: 'Bash', command: 'git push' }, 'a1'))
    await check('a1', 'git push')
    await clock.advance(1_000)
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ◉ Explore find loaders <1m · 1 tool   ⎿ approve Bash · git push')

    await modelRequest($, 'a1')
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find loaders <1m · 1 tool · 0 tokens')
  })

  test('shows the call still running when another call of the same tool ends first', async ($, on) => {
    const { clock, releases } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const ui = await mount($)
    const read = $.tool.call(inAgent({ tool: 'Bash', command: 'npm test' }, 'a1'))
    const list = $.tool.call(inAgent({ tool: 'Bash', command: 'ls' }, 'a1'))
    await clock.advance(0)

    releases[1]?.()
    await list
    expect(await textOf(ui, 'agent-a1')).toBe('▸ ⠋ Explore find loaders <1m · 2 tools   ⎿ Bash · npm test')
    releases[0]?.()
    await read
  })

  test("short of room, keeps the approve line of a waiting agent while other agents' ⎿ lines go", async ($, on) => {
    const { clock, check, release } = await asking($, on)
    const calls = []
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await spawn($, id, id)
      calls.push($.tool.call(inAgent({ tool: 'Bash', command: 'sleep 1' }, id)))
    }
    await check('a1', 'sleep 1')
    await clock.advance(1_000)

    // 16 rows give the agents 5: the heading and four agents, and one more
    // row for the line of the one that waits.
    const tight = await mount($, { rows: 16 })
    expect(await textOf(tight, 'agent-a1')).toBe('▸ ◉ Explore a1 <1m · 1 tool   ⎿ approve Bash · sleep 1')
    expect(await textOf(tight, 'agent-a2')).toBe('▸ ⠋ Explore a2 <1m · 1 tool')
    release()
    await Promise.all(calls)
  })

  test("shares a waiting agent with the other sessions' glimts", async ($, on) => {
    const { clock, stored, check, release } = await asking($, on)
    await spawn($, 'a1', 'find loaders')
    const call = $.tool.call(inAgent({ tool: 'Bash', command: 'npm test' }, 'a1'))
    await check('a1', 'npm test')
    await clock.advance(5_000)

    expect(stored.get('agents:self-full')).toEqual({
      at: 5_000,
      agents: [
        { id: 'a1', type: 'Explore', description: 'find loaders', task: 'find loaders', startedAt: 0, tools: 1, tool: 'Bash', asking: 'Bash' },
      ],
      watching: true,
    })
    release()
    await call
  })
})

describe('models', () => {
  test('names a model as people say it, a dated id by its version, and leaves an id it does not know as it is', async ($, on) => {
    mock.clock(on)
    const models: Record<string, string> = { a1: 'claude-sonnet-4-20250514', a2: 'gateway-model-x' }
    on('agent.spawn', (_$, e) => ({ model: models[e.tool_use_id.slice(3)] ?? '', agentId: e.tool_use_id.slice(3) }))
    await spawn($, 'a1', 'one')
    await spawn($, 'a2', 'two')
    const ui = await mount($, { isFocused: true })
    await ui.press({ key: 'key-down' })
    await ui.press({ key: 'key-down' })

    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore one  <1m · 0 tools · Sonnet 4')
    await ui.press({ key: 'key-back' })
    await ui.press({ key: 'key-down' })
    await ui.press({ key: 'key-into' })
    expect(await textOf(ui, 'drill-title')).toBe('⠋ Explore two  <1m · 0 tools · gateway-model-x')
  })
})

describe('stopping an agent', () => {
  // The pane, focused, its cursor on a1, which runs in the background or
  // not; TaskStop answers with `stop`.
  type Stopped = { result: { message: string; task_id: string; task_type: string } }
  const STOPPED: Stopped = { result: { message: 'Stopped', task_id: 'a1', task_type: 'local_agent' } }

  async function onAgentRow($: Engine, on: On, background: boolean, stop: () => Stopped = () => STOPPED) {
    mock.clock(on)
    loops(on)
    const stopped: string[] = []
    const toasts: string[] = []
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
      stopped.push(e.task_id ?? '')
      return stop()
    })
    await spawn($, 'a1', 'find loaders', { background })
    const ui = await mount($, { isFocused: true })
    await ui.press({ key: 'key-down' })
    await ui.press({ key: 'key-down' })
    const offersStop = async () => (await ui.findAll({ type: 'Button' })).some(button => button.key === 'key-stop')

    return { ui, stopped, toasts, offersStop }
  }

  test('x asks before stopping a background agent: n keeps it, y stops it with TaskStop', async ($, on) => {
    const { ui, stopped, offersStop } = await onAgentRow($, on, true)
    expect(await offersStop()).toBe(true)

    await ui.press({ key: 'key-stop' })
    expect(await textOf(ui, 'stop-agent-a1')).toBe('Stop Explore find loaders?yesno')
    await ui.press({ key: 'stop-no' })
    expect(await ui.find({ key: 'stop-agent-a1' })).toBeUndefined()
    expect(stopped).toEqual([])

    await ui.press({ key: 'key-stop' })
    await ui.press({ key: 'stop-yes' })
    expect(stopped).toEqual(['a1'])
  })

  test('offers no x on an agent that runs in the foreground', async ($, on) => {
    const { offersStop } = await onAgentRow($, on, false)

    expect(await offersStop()).toBe(false)
  })

  test('passes on why an agent could not be stopped', async ($, on) => {
    const { ui, toasts } = await onAgentRow($, on, true, () => {
      throw new Error('No task found with ID a1')
    })

    await ui.press({ key: 'key-stop' })
    await ui.press({ key: 'stop-yes' })
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.startsWith('Could not stop Explore find loaders')).toBe(true)
  })
})
