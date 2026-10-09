import { describe, expect, mock, test } from 'claude-code/testing'
import {
  LONG_CLOCK,
  SURFACES,
  ask,
  create,
  inAgent,
  loops,
  mount,
  prompts,
  setStatus,
  spawn,
  startSession,
  stepOrder,
  taskTools,
  textOf,
} from './kit'

describe('plan', () => {
  test('shows the task list as the plan, with progress and the step in progress', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await create($, 'Read API types', { activeForm: 'Reading API types' })
    await create($, 'Write the pane', { activeForm: 'Writing the pane' })
    await create($, 'Publish', { activeForm: 'Publishing' })
    await setStatus($, '1', 'completed')
    await setStatus($, '2', 'in_progress')

    for (const surface of SURFACES) {
      const ui = await mount($, { surface })
      expect(await textOf(ui, 'plan-heading')).toBe('Plan  1/3')
      expect(await textOf(ui, 'step-1')).toBe('▸ ☒ Read API types')
      expect(await textOf(ui, 'step-2')).toBe('▸ ◐ Write the pane')
      expect(await textOf(ui, 'step-3')).toBe('▸ ☐ Publish')
      expect(await textOf(ui, 'now')).toBe('◐ Writing the pane')
      await ui.unmount()
    }
  })

  test('drops a deleted task', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await create($, 'Keep')
    await create($, 'Drop')
    await setStatus($, '2', 'deleted')

    const ui = await mount($)
    expect(await ui.find({ key: 'step-2' })).toBeUndefined()
    expect(await textOf(ui, 'plan-heading')).toBe('Plan  0/1')
  })

  test('shows a task updated before the pane saw it, under its id', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await setStatus($, '7', 'in_progress')

    const ui = await mount($)
    expect(await textOf(ui, 'step-7')).toBe('▸ ◐ Task 7')
  })

  test("keeps a subagent's own tasks out of the plan", async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await create($, 'A worker step', { agentId: 'worker-1' })

    const ui = await mount($)
    expect(await textOf(ui, 'no-steps')).toBe('No steps yet.')
  })

  test('names an approved plan by its first heading', async ($, on) => {
    mock.clock(on)
    on('tool.call', { tool: 'ExitPlanMode' }, () => ({
      result: { plan: '\n# glimt pane\n\nThe steps.', isAgent: false, filePath: '/plans/glimt.md' },
    }))
    await $.tool.call({ tool: 'ExitPlanMode' })

    const ui = await mount($)
    expect(await textOf(ui, 'plan-heading')).toBe('Plan · glimt pane')
  })

  test("opens a step to show its description, wrapped to the pane's width", async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await create($, 'Write the pane', { description: 'Draw the request, the plan and the agents in a docked pane' })

    const ui = await mount($, { columns: 30 })
    expect(await ui.find({ key: 'detail-1' })).toBeUndefined()

    await ui.press({ key: 'toggle-1' })
    // 30 columns less the 4 the description is indented by: lines of 26.
    expect(await textOf(ui, 'detail-1')).toBe('Draw the request, the planand the agents in a dockedpane')
    expect((await textOf(ui, 'step-1'))?.startsWith('▾ ☐ Write the pane')).toBe(true)

    await ui.press({ key: 'toggle-1' })
    expect(await ui.find({ key: 'detail-1' })).toBeUndefined()
  })

  test("reads a seeded step's description the first time it is opened", async ($, on) => {
    mock.clock(on)
    on('tool.call', { tool: 'TaskGet' }, (_$, e) => ({
      result: { task: { id: e.taskId, subject: 'Done before', description: 'From TaskGet', status: 'completed', blocks: [], blockedBy: [] } },
    }))
    await startSession($, on, { tasks: [{ id: '1', subject: 'Done before', status: 'completed', blockedBy: [] }] })

    const ui = await mount($)
    await ui.press({ key: 'toggle-1' })
    expect(await textOf(ui, 'detail-1')).toBe('From TaskGet')
  })

  test('fits the plan to the room: finished steps fold first, then the rest is counted', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    for (const subject of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
      await create($, subject, { activeForm: `doing ${subject}` })
    }
    await setStatus($, '1', 'completed')
    await setStatus($, '2', 'completed')
    await setStatus($, '3', 'completed')
    await setStatus($, '4', 'in_progress')

    // 18 rows: 1 for this session, 2 for Now, 2 for the agents, 2 for the sessions, the plan's heading and 4 blank leave 6.
    const roomy = await mount($, { rows: 18 })
    expect(await textOf(roomy, 'folded')).toBe('  ☒ 3 done')
    expect(await textOf(roomy, 'step-4')).toBe('▸ ◐ four')
    expect(await textOf(roomy, 'step-8')).toBe('▸ ☐ eight')
    expect(await roomy.find({ key: 'more' })).toBeUndefined()
    expect(await textOf(roomy, 'plan-heading')).toBe('Plan  3/8')
    await roomy.unmount()

    // 16 rows leave 4.
    const tight = await mount($, { rows: 16 })
    expect(await textOf(tight, 'folded')).toBe('  ☒ 3 done')
    expect(await textOf(tight, 'step-4')).toBe('▸ ◐ four')
    expect(await textOf(tight, 'step-5')).toBe('▸ ☐ five')
    expect(await tight.find({ key: 'step-6' })).toBeUndefined()
    expect(await textOf(tight, 'more')).toBe('  ☐ 3 more')
  })
})

describe('layout', () => {
  test("puts each section's count right beside its label, cutting a label too long for the room", async ($, on) => {
    mock.clock(on)
    taskTools(on)
    on('tool.call', { tool: 'ExitPlanMode' }, () => ({ result: { plan: '# A plan title much longer than the pane', isAgent: false } }))
    await create($, 'one')
    const ui = await mount($, { columns: 40 })
    expect(await textOf(ui, 'plan-heading')).toBe('Plan  0/1')
    expect(await textOf(ui, 'now-heading')).toBe('Now')
    await ui.unmount()

    // 20 columns less "  0/1" leave the label 15.
    await $.tool.call({ tool: 'ExitPlanMode' })
    const narrow = await mount($, { columns: 20 })
    expect(await textOf(narrow, 'plan-heading')).toBe('Plan · A plan …  0/1')
  })

  test('stacks Now, Plan, Agents and Sessions from the top, always in that order', async ($, on) => {
    mock.clock(on)
    const ui = await mount($)

    const headings = (await ui.findAll({ type: 'Box' })).map(box => box.key).filter(key => key?.endsWith('-heading') === true)
    expect(headings).toEqual(['now-heading', 'plan-heading', 'agents-heading', 'sessions-heading'])
  })

  test("puts an agent's time and tools on a line of their own in a narrow pane", async ($, on) => {
    mock.clock(on)
    loops(on)
    await spawn($, 'a1', 'find hook loaders')

    const wide = await mount($, { columns: 50 })
    expect(await textOf(wide, 'agent-a1')).toBe('▸ ⠋ Explore find hook loaders <1m · 0 tools')
    await wide.unmount()

    const narrow = await mount($, { columns: 30 })
    expect(await textOf(narrow, 'agent-a1')).toBe('▸ ⠋ Explore find hook loaders   <1m · 0 tools')
  })
})

describe('now', () => {
  test('shows the step in progress and how long it has been, counting on while idle', LONG_CLOCK, async ($, on) => {
    const clock = mock.clock(on)
    taskTools(on)
    await startSession($, on)
    await create($, 'Write the pane', { activeForm: 'Writing the pane' })
    await clock.advance(5_000)
    await setStatus($, '1', 'in_progress')
    const ui = await mount($)

    await clock.advance(90_000)
    expect(await textOf(ui, 'now-heading')).toBe('Now  1m30s')
    expect(await textOf(ui, 'now')).toBe('◐ Writing the pane')

    await setStatus($, '1', 'completed')
    expect(await textOf(ui, 'now-heading')).toBe('Now')
    expect(await textOf(ui, 'now')).toBe('No step in progress.')
  })

  test('spins the step in progress while a turn runs, and only there', async ($, on) => {
    const clock = mock.clock(on)
    loops(on)
    taskTools(on)
    await startSession($, on)
    await create($, 'Write the pane', { activeForm: 'Writing the pane' })
    await setStatus($, '1', 'in_progress')
    await $.turn.start({ text: '', turnId: 't1' })
    const ui = await mount($)

    expect(await textOf(ui, 'now')).toBe('⠋ Writing the pane')
    await clock.advance(100)
    expect(await textOf(ui, 'now')).toBe('⠙ Writing the pane')
    expect(await textOf(ui, 'step-1')).toBe('▸ ◐ Write the pane')
  })
})

describe('session', () => {
  test('opens the pane and shows the task list a resumed session already has', async ($, on) => {
    mock.clock(on)
    await startSession($, on, {
      tasks: [
        { id: '1', subject: 'Done before', status: 'completed', blockedBy: [] },
        { id: '2', subject: 'Still to do', status: 'pending', blockedBy: [] },
      ],
    })

    const ui = await mount($)
    expect(await textOf(ui, 'step-1')).toBe('▸ ☒ Done before')
    expect(await textOf(ui, 'step-2')).toBe('▸ ☐ Still to do')
  })

  test('/clear empties the pane', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    loops(on)
    prompts(on)
    on('session.end', () => ({ sessionId: 's1' }))
    await ask($, 'Old request')
    await create($, 'Old step')
    await setStatus($, '1', 'in_progress')
    await spawn($, 'a1', 'old agent')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

    const ui = await mount($)
    expect(await textOf(ui, 'now')).toBe('No step in progress.')
    expect(await textOf(ui, 'no-steps')).toBe('No steps yet.')
    expect(await textOf(ui, 'no-agents')).toBe('No agents running.')
  })
})

describe('sub-steps', () => {
  test('nests a step under the one its metadata.parent names, and lifts it out when cleared', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await create($, 'Parent')
    await create($, 'Other')
    await create($, 'Child', { parent: '1' })
    const ui = await mount($)

    expect(await stepOrder(ui)).toEqual(['step-1', 'step-3', 'step-2'])
    expect(await textOf(ui, 'step-3')).toBe('  ▸ ☐ Child')

    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', metadata: { parent: null } })
    expect(await stepOrder(ui)).toEqual(['step-1', 'step-2', 'step-3'])
    expect(await textOf(ui, 'step-3')).toBe('▸ ☐ Child')
  })

  test("nests a subagent's own tasks under the step in progress when it started, and its spawn's under the same", async ($, on) => {
    mock.clock(on)
    loops(on)
    taskTools(on)
    await create($, 'Build the pane')
    await setStatus($, '1', 'in_progress')
    await spawn($, 'a1', 'worker')
    await create($, 'Worker step', { agentId: 'a1' })
    await $.tool.call(inAgent({ tool: 'TaskUpdate', taskId: '2', status: 'completed' }, 'a1'))
    // The main loop moves on; an agent a1 spawns still works for step 1.
    await create($, 'Ship it')
    await setStatus($, '1', 'completed')
    await setStatus($, '3', 'in_progress')
    await spawn($, 'a2', 'nested', { parent: 'a1' })
    await create($, 'Nested step', { agentId: 'a2' })
    const ui = await mount($)

    expect(await stepOrder(ui)).toEqual(['step-1', 'step-a1/2', 'step-a2/4', 'step-3'])
    expect(await textOf(ui, 'step-a1/2')).toBe('  ▸ ☒ Worker step')
    expect(await textOf(ui, 'step-a2/4')).toBe('  ▸ ☐ Nested step')
  })

  test('leaves out the tasks of a subagent started while no step was in progress', async ($, on) => {
    mock.clock(on)
    loops(on)
    taskTools(on)
    await spawn($, 'a1', 'worker')
    await create($, 'Worker step', { agentId: 'a1' })

    const ui = await mount($)
    expect(await textOf(ui, 'no-steps')).toBe('No steps yet.')
  })

  test('folds a finished step together with its sub-steps', async ($, on) => {
    mock.clock(on)
    taskTools(on)
    await create($, 'one')
    await create($, 'one, first part', { parent: '1' })
    for (const subject of ['two', 'three', 'four', 'five', 'six']) {
      await create($, subject)
    }
    await setStatus($, '1', 'completed')
    await setStatus($, '2', 'completed')
    await setStatus($, '3', 'in_progress')

    // 18 rows leave the plan 6, and it has 7 steps.
    const ui = await mount($, { rows: 18 })
    expect(await textOf(ui, 'folded')).toBe('  ☒ 2 done')
    expect(await textOf(ui, 'step-3')).toBe('▸ ◐ two')
    expect(await textOf(ui, 'step-7')).toBe('▸ ☐ six')
    expect(await ui.find({ key: 'more' })).toBeUndefined()
    expect(await textOf(ui, 'plan-heading')).toBe('Plan  2/7')
  })
})

describe('system prompt', () => {
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], outputStyle: null, traits: [] } as const

  test('asks Claude to file sub-steps under their step while the task tools are on offer', async ($, on) => {
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))

    const offered = await $.prompt.compose({ ...COMPOSE, tools: ['Read', 'TaskCreate'] })
    expect(offered.sections.map(section => section.id)).toEqual(['intro', 'glimt:sub-steps'])
    // The field the note names is the one the plan reads.
    expect(offered.sections[1]?.text).toContain('metadata.parent')

    const without = await $.prompt.compose({ ...COMPOSE, tools: ['Read'] })
    expect(without.sections.map(section => section.id)).toEqual(['intro'])
  })

  test('an empty plan says the session has no task list while Claude is offered none; once one is, it says no steps', async ($, on) => {
    on('prompt.compose', () => ({ sections: [] }))
    const ui = await mount($)

    await $.prompt.compose({ ...COMPOSE, tools: ['Read'] })
    expect(await textOf(ui, 'no-steps')).toBe('No task list in this session.')
    await $.prompt.compose({ ...COMPOSE, tools: ['Read', 'TodoWrite'] })
    expect(await textOf(ui, 'no-steps')).toBe('No steps yet.')
    // A request that offers none, such as a subagent's, changes nothing.
    await $.prompt.compose({ ...COMPOSE, tools: ['Read'] })
    expect(await textOf(ui, 'no-steps')).toBe('No steps yet.')
  })
})
