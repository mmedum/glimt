// What drawing needs beside the state, and the pieces every section draws.

import type { ElementTable } from 'claude-code'
import { cells, fit } from './text'
import type { Part } from './text'

export type Ui = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
export type InputElement = ElementTable<'terminal' | 'desktop'>['Input']

// What drawing needs beside the state: the elements (an Input where the
// surface has one), the width, the time, the toggle the cursor is on, and
// what pressing a toggle does.
export type View = {
  ui: Ui
  Input?: InputElement | undefined
  columns: number
  at: number
  isTurnRunning: boolean
  cursor: string | null
  toggle: (id: string) => void
}

// A section's heading: its label, bold, and what the section counts right
// beside it, dim. Nearness ties the count to its label; the blank row above
// each section sets the sections apart.
export function heading({ ui: { Box, Text }, columns }: View, key: string, label: string, count: string) {
  const shown = fit(label, count === '' ? columns : Math.max(1, columns - cells(count) - 2))

  return (
    <Box key={key} flexDirection="row">
      <Text bold>{shown}</Text>
      {count !== '' && <Text dimColor>{fit(`  ${count}`, columns - cells(shown))}</Text>}
    </Box>
  )
}

// A row of facts joined by dim " · ": each dim, or in its own color (amber
// for a risk) or at full weight (a limit nearly reached).
export function partsNode({ ui: { Text } }: View, parts: Part[]) {
  return (
    <Text>
      {parts.map((part, i) => (
        <Text>
          {i > 0 && <Text dimColor> · </Text>}
          <Text
            {...(part.color === undefined ? {} : { color: part.color })}
            bold={part.isBold === true}
            dimColor={part.color === undefined && part.isBold !== true}
          >
            {part.text}
          </Text>
        </Text>
      ))}
    </Text>
  )
}

// The cells a key takes on its row: the hotkey, a colon and a space, the label.
export function keyWidth(label: string): number {
  return 3 + cells(label)
}

// How many rows a row of items `widths` wide takes once it wraps at
// `columns`, `gap` cells apart.
export function wrappedRows(widths: readonly number[], columns: number, gap: number): number {
  let rows = 1
  let used = 0
  for (const width of widths) {
    if (used > 0 && used + gap + width > columns) {
      rows += 1
      used = width
    } else {
      used = used === 0 ? width : used + gap + width
    }
  }

  return rows
}

export function keyButton({ ui: { Button } }: View, name: string, hotkey: string, label: string, press: () => void) {
  return <Button key={`key-${name}`} plain dimColor hotkey={hotkey} label={label} onPress={press} />
}
