import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { colorOf } from '../hooks/paint'
import { create, finish, loops, mount, moveTo, setStatus, spawn, taskTools } from './kit'
import type { Mounted } from './kit'
import { AGENTS_MACHINE, LISTED, machine } from './machine'

// The color options set, each to a color of its own.
const SET = { quietColor: '#7aa2f7', markColor: 'ansi256(110)', headingColor: 'claude' }

// The pane an hour in, with one of each thing it colors: this session's row
// opened; the plan with a step done, the one in progress and one to do; the
// main conversation with an agent at work and one done; the other sessions
// waiting, working and idle, the idle one sharing its plan and opened to its
// agents, one of them quiet.
async function scene($: Engine, on: On) {
  loops(on)
  taskTools(on)
  await machine($, on, { ...AGENTS_MACHINE, stored: { 'agents:1879e383-full': { at: 3_600_000, agents: [], plan: { done: 2, total: 5 } } } })
  await create($, 'Read the types')
  await create($, 'Write the pane')
  await create($, 'Publish')
  await setStatus($, '1', 'completed')
  await setStatus($, '2', 'in_progress')
  await $.turn.start({ text: '', turnId: 't1' })
  await spawn($, 'a1', 'find loaders')
  await spawn($, 'a2', 'review the diff')
  await finish($, 'a2')
  const ui = await mount($)
  await ui.press({ key: 'toggle-self' })
  await ui.press({ key: 'toggle-session-1879e383-full' })

  return ui
}

// For each of `texts`, the colors of the Texts that show exactly it, in the
// order drawn.
async function paint(ui: Pick<Mounted, 'findAll'>, texts: readonly string[]): Promise<Record<string, unknown[]>> {
  const all = await ui.findAll({ type: 'Text' })

  return Object.fromEntries(
    texts.map(text => [text, all.filter(one => one.text === text && one.props.color !== undefined).map(one => one.props.color)]),
  )
}

describe('colors', () => {
  test("reads a color as Claude Code's custom themes spell one, and falls back on anything else", () => {
    const cases: [unknown, string][] = [
      ['inactive', 'inactive'],
      ['claude', 'claude'],
      ['briefLabelClaude', 'briefLabelClaude'],
      ['inactiveShimmer', 'inactiveShimmer'],
      ['blue_FOR_SUBAGENTS_ONLY', 'blue_FOR_SUBAGENTS_ONLY'],
      ['rainbow_violet_shimmer', 'rainbow_violet_shimmer'],
      ['cyan', 'ansi256(6)'],
      ['redBright', 'ansi256(9)'],
      ['gray', 'ansi256(8)'],
      [' #F80 ', '#f80'],
      ['#7AA2F7', '#7aa2f7'],
      ['rgb(122, 162, 247)', '#7aa2f7'],
      ['rgb(255, 255, 255)', '#ffffff'],
      ['ansi256(0)', 'ansi256(0)'],
      ['ansi256( 110 )', 'ansi256(110)'],
      ['ansi256(255)', 'ansi256(255)'],
      ['ansi:black', 'ansi256(0)'],
      ['ansi:cyan', 'ansi256(6)'],
      [' ansi:blackBright ', 'ansi256(8)'],
      ['ansi:whiteBright', 'ansi256(15)'],
      ['ansi:grey', 'ansi256(8)'],
      ['rgb(256, 0, 0)', 'inactive'],
      ['ansi256(256)', 'inactive'],
      ['ansi:teal', 'inactive'],
      ['#12345', 'inactive'],
      ['nonsense', 'inactive'],
      [42, 'inactive'],
    ]
    for (const [value, expected] of cases) {
      expect(colorOf(value, 'inactive')).toBe(expected)
    }
  })

  test("by default draws quiet text and the marks of a step to do or an idle session in Claude Code's color for hints, and the headings in its text color", async ($, on) => {
    const ui = await scene($, on)

    const want = {
      '  1/3': ['inactive'],
      ' 0s · 0 tools': ['inactive'],
      '☐': ['inactive'],
      '○': ['inactive', 'inactive'],
      Plan: ['text'],
      Sessions: ['text'],
    }
    expect(await paint(ui, Object.keys(want))).toEqual(want)
  })

  test(
    'draws quiet text, the marks of a step to do or an idle session or agent, and the headings each in its color option',
    { options: SET },
    async ($, on) => {
      const ui = await scene($, on)

      const want = {
        // This session's row, opened.
        '  this session': ['#7aa2f7'],
        '  ⎿ ~/code · ba4f4809': ['#7aa2f7'],
        // What each heading counts.
        '  0s': ['#7aa2f7'],
        '  1/3': ['#7aa2f7'],
        '  2 running': ['#7aa2f7'],
        '  1 waiting · 1 working': ['#7aa2f7'],
        // A step done, an agent done, and the agents' tree.
        ' ☒ Read the types': ['#7aa2f7'],
        '✓ Explore review the diff': ['#7aa2f7'],
        ' 0s · 0 tools': ['#7aa2f7'],
        '├─ ': ['#7aa2f7'],
        '└─ ': ['#7aa2f7'],
        // An idle session, its facts, where it runs and its agents, one quiet.
        ' ○ docs-site': ['#7aa2f7'],
        idle: ['#7aa2f7'],
        ' · ': ['#7aa2f7'],
        '2/5': ['#7aa2f7'],
        '  ⎿ ~/code/docs · terminal · 1879e383-full': ['#7aa2f7'],
        '  └─ ': ['#7aa2f7'],
        ' ○ general-purpose review the diff': ['#7aa2f7'],
        ' 1m ago': ['#7aa2f7', '#7aa2f7'],
        // The marks of a step to do, an idle session and a quiet agent.
        '☐': ['ansi256(110)'],
        '○': ['ansi256(110)', 'ansi256(110)'],
        Now: ['claude'],
        Plan: ['claude'],
        Agents: ['claude'],
        Sessions: ['claude'],
      }
      expect(await paint(ui, Object.keys(want))).toEqual(want)
    },
  )

  // An ansi: name, which Claude Code refuses as written: the whole pane
  // would fall back to its own drawing.
  test('draws the pane with a color option given as an ansi: name', { options: { quietColor: 'ansi:cyan' } }, async ($, on) => {
    loops(on)
    await machine($, on, { listed: [LISTED[2]] })
    const ui = await mount($)

    const empty = 'glimt · the plan, agents and other sessions show here as they start'
    expect(await paint(ui, [empty])).toEqual({ [empty]: ['ansi256(6)'] })
  })

  test("keeps the status marks in the theme's status colors, whatever the color options", { options: SET }, async ($, on) => {
    const ui = await scene($, on)

    const want = {
      '☒': ['success'],
      '◐': ['claude'],
      '✓': ['success'],
      '◉': ['warning'],
      // The main conversation, an agent of this session, a working session
      // and two agents of the idle one at work.
      '⠋': ['claude', 'claude', 'claude', 'claude', 'claude'],
    }
    expect(await paint(ui, Object.keys(want))).toEqual(want)
  })

  test(
    'draws the quiet text of the empty pane, an agent gone into, the key list and the chat in the Quiet text color too',
    { options: SET },
    async ($, on) => {
      loops(on)
      await machine($, on, { listed: [LISTED[2]] })
      const first = await mount($)
      const empty = 'glimt · the plan, agents and other sessions show here as they start'
      expect(await paint(first, [empty])).toEqual({ [empty]: ['#7aa2f7'] })
      await first.unmount()

      await spawn($, 'a1', 'find loaders', { prompt: 'Find where hooks are loaded.' })
      const ui = await mount($, { isFocused: true })
      await moveTo($, 'toggle-agent-a1')
      await ui.press({ key: 'key-into' })
      const drilled = { '  <1m · 0 tools · Haiku 5.5': ['#7aa2f7'], '  Find where hooks are loaded.': ['#7aa2f7'] }
      expect(await paint(ui, Object.keys(drilled))).toEqual(drilled)

      await ui.press({ key: 'key-help' })
      expect(await paint(ui, ['glimt · github.com/mmedum/glimt'])).toEqual({ 'glimt · github.com/mmedum/glimt': ['#7aa2f7'] })

      // A running agent's row in the chat, squeezed to one line while the pane is drawn.
      const row = await $.ui.mount({
        plugin: 'glimt',
        surface: 'terminal',
        component: 'ToolUse',
        props: {
          tool_use_id: 'tu-a2',
          tool: 'Agent',
          input: { subagent_type: 'Explore', description: 'map the hooks', prompt: 'p' },
          isRunning: true,
          isErrored: false,
          isInterrupted: false,
        },
      })
      expect(await paint(row, ['⠋ Explore · map the hooks'])).toEqual({ '⠋ Explore · map the hooks': ['#7aa2f7'] })
    },
  )
})
