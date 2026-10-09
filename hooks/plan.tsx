// The plan: Claude's task list as steps and sub-steps, and what is in
// progress now.

import type { Plan, Step, StepStatus } from '../types'
import { clip, duration, fit, spin, wrap } from './text'
import { heading } from './view'
import type { View } from './view'

// How far a sub-step is indented under its step, per level.
export const INDENT = 2

export type StepUpdate = {
  taskId: string
  subject?: string | undefined
  description?: string | undefined
  activeForm?: string | undefined
  status?: StepStatus | 'deleted' | undefined
  // A new parent, or null to make it a step of its own.
  parent?: string | null | undefined
}

// A line of the plan as drawn: a step at its depth under the top level, with
// its description when opened, or a line standing for steps folded or cut.
export type StepLine = { kind: 'step'; step: Step; depth: number; detail: string[] }
export type PlanLine = StepLine | { kind: 'done'; count: number } | { kind: 'more'; count: number }

// The task a sub-step belongs to, from its metadata.parent; null when the
// update clears it, undefined when the call does not say.
export function parentFrom(metadata: unknown): string | null | undefined {
  if (typeof metadata !== 'object' || metadata === null || !('parent' in metadata)) {
    return undefined
  }

  const parent: unknown = metadata.parent
  if (parent === null) {
    return null
  }

  return typeof parent === 'string' || typeof parent === 'number' ? String(parent) : undefined
}

// A step's time in progress starts when it goes in progress, at `at`, and
// is dropped when it leaves.
export function applyUpdate(list: Step[], change: StepUpdate, at: number): Step[] {
  if (change.status === 'deleted') {
    return list.filter(step => step.id !== change.taskId)
  }

  const status = change.status
  const known = list.some(step => step.id === change.taskId)
  const updated = list.map(step => {
    if (step.id !== change.taskId) {
      return step
    }

    const next = status ?? step.status
    return {
      ...step,
      subject: change.subject ?? step.subject,
      description: change.description ?? step.description,
      activeForm: change.activeForm ?? step.activeForm,
      status: next,
      startedAt: next !== 'in_progress' ? undefined : step.status === 'in_progress' ? step.startedAt : at,
      parentId: change.parent === undefined ? step.parentId : (change.parent ?? undefined),
    }
  })

  // A task made before this pane was watching: show it under what is known.
  return known
    ? updated
    : [
        ...updated,
        {
          id: change.taskId,
          subject: change.subject ?? `Task ${change.taskId}`,
          description: change.description,
          activeForm: change.activeForm,
          status: status ?? 'pending',
          startedAt: status === 'in_progress' ? at : undefined,
          parentId: change.parent ?? undefined,
        },
      ]
}

// The plan as units to draw: each top-level step with the steps under it,
// depth first. A step whose parent is gone, or whose parents loop back to
// it, stands at the top level.
export function planUnits(list: Step[], open: readonly string[], columns: number): StepLine[][] {
  const ids = new Set(list.map(step => step.id))
  const parentOf = (step: Step) => (step.parentId !== undefined && ids.has(step.parentId) ? step.parentId : undefined)
  const seen = new Set<string>()
  const lineOf = (step: Step, depth: number): StepLine => ({
    kind: 'step',
    step,
    depth,
    detail: open.includes(step.id) ? detailLines(step, columns - 4 - depth * INDENT) : [],
  })
  const under = (parent: string, depth: number): StepLine[] =>
    list
      .filter(step => parentOf(step) === parent && !seen.has(step.id))
      .flatMap(step => {
        seen.add(step.id)
        return [lineOf(step, depth), ...under(step.id, depth + 1)]
      })
  const unitOf = (step: Step): StepLine[] => {
    seen.add(step.id)
    return [lineOf(step, 0), ...under(step.id, 1)]
  }

  const units = list.filter(step => parentOf(step) === undefined).map(unitOf)
  for (const step of list) {
    if (!seen.has(step.id)) {
      units.push(unitOf(step))
    }
  }

  return units
}

// The plan's lines in `room` rows. A step and its sub-steps move together:
// finished ones fold into one line, oldest first, until the rest fits; then
// the tail is cut and its steps counted, so the step in progress stays in view.
export function planLines(units: StepLine[][], room: number): PlanLine[] {
  const all = units.flat()
  if (rowCount(all) <= room) {
    return all
  }

  const finished = units.filter(unit => unit.every(line => line.step.status === 'completed'))
  let rest = units
  let shown: PlanLine[] = all
  for (let folded = 1; folded <= finished.length && rowCount(shown) > room; folded += 1) {
    const hidden = new Set(finished.slice(0, folded))
    rest = units.filter(unit => !hidden.has(unit))
    shown = [{ kind: 'done', count: finished.slice(0, folded).flat().length }, ...rest.flat()]
  }
  if (rowCount(shown) <= room) {
    return shown
  }

  const head = shown.filter(line => line.kind === 'done')
  for (let kept = rest.length - 1; kept >= 1; kept -= 1) {
    const cut: PlanLine[] = [...head, ...rest.slice(0, kept).flat(), { kind: 'more', count: rest.slice(kept).flat().length }]
    if (rowCount(cut) <= room) {
      return cut
    }
  }

  // Room for less than the first step and its sub-steps: its lines from the
  // top, the last one's description cut to fit.
  const budget = room - head.length - 1
  const taken: StepLine[] = []
  for (const line of rest[0] ?? []) {
    const used = rowCount(taken)
    if (used + 1 > budget) {
      break
    }
    taken.push({ ...line, detail: clip(line.detail, budget - used - 1) })
  }
  const left = rest.flat().length - taken.length

  return [...head, ...taken, ...(left > 0 ? [{ kind: 'more' as const, count: left }] : [])]
}

export function rowCount(lines: readonly PlanLine[]): number {
  return lines.reduce((sum, line) => sum + 1 + (line.kind === 'step' ? line.detail.length : 0), 0)
}

export function detailLines(step: Step, width: number): string[] {
  if (step.description === undefined) {
    return ['Loading…']
  }

  const lines = step.description.split('\n').flatMap(paragraph => wrap(paragraph, width))

  return lines.length === 0 ? ['No description.'] : lines
}

// The plan's first heading, or its first line when it has none.
export function planTitle(text: string): string {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const title = lines.find(line => line.startsWith('#')) ?? lines[0] ?? 'Plan'

  return title.replace(/^#+\s*/, '')
}

// The steps in progress, and how long the first has been: a step left in
// progress while nothing runs shows its age here.
export function nowSection(view: View, list: Step[]) {
  const { Box, Text } = view.ui
  const active = list.filter(step => step.status === 'in_progress')
  const since = active[0]?.startedAt
  const mark = view.isTurnRunning ? spin(view.at) : '◐'

  return {
    rows: 1 + Math.max(1, active.length),
    node: (
      <Box flexDirection="column">
        {heading(view, 'now-heading', 'Now', since === undefined ? '' : duration(view.at - since))}
        <Box key="now" flexDirection="column">
          {active.length === 0 ? (
            <Text dimColor>No step in progress.</Text>
          ) : (
            active.map(step => <Text color="claude">{fit(`${mark} ${step.activeForm ?? step.subject}`, view.columns)}</Text>)
          )}
        </Box>
      </Box>
    ),
  }
}

// Claude Code's checklist marks: ☒ done, ☐ to do; ◐ for the step in progress.
export const STEP_MARK: Record<StepStatus, { mark: string; color: string }> = {
  completed: { mark: '☒', color: 'success' },
  in_progress: { mark: '◐', color: 'claude' },
  pending: { mark: '☐', color: 'subtle' },
}

export function planSection(view: View, approved: Plan | null, list: Step[], lines: PlanLine[]) {
  const { Box, Button, Text } = view.ui
  const done = list.filter(step => step.status === 'completed').length

  return (
    <Box flexDirection="column">
      {heading(view, 'plan-heading', approved === null ? 'Plan' : `Plan · ${approved.title}`, list.length === 0 ? '' : `${done}/${list.length}`)}
      {list.length === 0 && (
        <Box key="no-steps">
          <Text dimColor>No steps yet.</Text>
        </Box>
      )}
      {lines.map(line => {
        if (line.kind === 'done') {
          return (
            <Box key="folded">
              <Text dimColor>
                {'  '}
                <Text color="success">☒</Text> {line.count} done
              </Text>
            </Box>
          )
        }
        if (line.kind === 'more') {
          return (
            <Box key="more">
              <Text dimColor>
                {'  '}☐ {line.count} more
              </Text>
            </Box>
          )
        }

        const { step, detail, depth } = line
        const indent = ' '.repeat(depth * INDENT)
        const isOpen = detail.length > 0
        const { mark, color } = STEP_MARK[step.status]

        return (
          <Box key={`step-${step.id}`} flexDirection="column">
            <Box flexDirection="row">
              {indent !== '' && <Text>{indent}</Text>}
              <Button key={`toggle-${step.id}`} plain label={isOpen ? '▾' : '▸'} onPress={() => view.toggle(step.id)} />
              <Text dimColor={step.status === 'completed'} bold={step.status === 'in_progress'}>
                {' '}
                <Text color={color}>{mark}</Text>{' '}
                <Text inverse={view.cursor === `toggle-${step.id}`}>{fit(step.subject, view.columns - 4 - indent.length)}</Text>
              </Text>
            </Box>
            {isOpen && (
              <Box key={`detail-${step.id}`} flexDirection="column" paddingLeft={4 + indent.length}>
                {detail.map(text => (
                  <Text dimColor>{text}</Text>
                ))}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
