// What drawing needs beside the state, and the pieces every section draws.

import type { ElementTable } from 'claude-code'
import { cells, fit } from './text'
import type { Part } from './text'

export type Ui = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
export type InputElement = ElementTable<'terminal' | 'desktop'>['Input']

// The color options, each a theme role or a color (see paint.ts): the quiet
// text, the marks that carry no status (a step to do, another session idle
// or done, or one of its agents gone quiet), the headings, without one bold
// in the terminal's own text color, and the band behind the cursor's row
// while the pane doesn't hold the keyboard; the status marks keep the
// theme's colors. Quiet text goes without dimColor, which would win over its
// color. A Button takes no color, so the keys stay dimColor: the theme's
// inactive.
export type Colors = { quiet: string; mark: string; heading: string | undefined; band: string }

// What drawing needs beside the state: the elements (an Input where the
// surface has one), the width, the time, the toggle the cursor is on,
// whether the pane's rows hold the keyboard (the pane does, and no form of
// glimt's is open), what pressing a toggle does, and the colors.
export type View = {
  ui: Ui
  Input?: InputElement | undefined
  columns: number
  at: number
  isTurnRunning: boolean
  cursor: string | null
  isFocused: boolean
  toggle: (id: string) => void
  colors: Colors
}

// The row whose toggle is `key`, while the cursor is on it: its name inverse
// while the rows hold the keyboard. Without it, the row you left keeps a
// quiet band across the pane in the Cursor band color, by default the
// theme's background behind your messages, as Neovim keeps a side panel's
// cursor line and lazygit its inactive selection, so it doesn't compete with
// the prompt or the form you type in. `row` goes on the row's Box, `name` on
// the Text of its name.
export function cursorStyle({ cursor, isFocused, colors }: View, key: string): { row: { backgroundColor?: string }; name: { inverse?: boolean } } {
  const isOn = cursor === key

  return { row: isOn && !isFocused ? { backgroundColor: colors.band } : {}, name: isOn && isFocused ? { inverse: true } : {} }
}

// A section's heading: its label, bold, in the Heading color where one is
// set, and what the section counts right beside it, quiet. Nearness ties the
// count to its label; the blank row above each section sets the sections
// apart.
export function heading({ ui: { Box, Text }, columns, colors }: View, key: string, label: string, count: string) {
  const shown = fit(label, count === '' ? columns : Math.max(1, columns - cells(count) - 2))

  return (
    <Box key={key} flexDirection="row">
      <Text bold {...(colors.heading === undefined ? {} : { color: colors.heading })}>
        {shown}
      </Text>
      {count !== '' && <Text color={colors.quiet}>{fit(`  ${count}`, columns - cells(shown))}</Text>}
    </Box>
  )
}

// A row of facts joined by quiet " · ": each quiet, or in its own color
// (amber for a risk) or at full weight (a limit nearly reached).
export function partsNode({ ui: { Text }, colors }: View, parts: Part[]) {
  return (
    <Text>
      {parts.map((part, i) => {
        const color = part.color ?? (part.isBold === true ? undefined : colors.quiet)
        return (
          <Text>
            {i > 0 && <Text color={colors.quiet}> · </Text>}
            <Text {...(color === undefined ? {} : { color })} bold={part.isBold === true}>
              {part.text}
            </Text>
          </Text>
        )
      })}
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
