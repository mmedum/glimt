// Text as the pane draws it: measured in cells, fitted, wrapped, and
// times and counts written short.

// The pane measures text in code points (see cells), so spreading a string
// into its code points is how it is measured and cut here.
/* oxlint-disable typescript/no-misused-spread */

// The braille spinner the skins mod's spinner turns too, a frame every
// FRAME_MS while something runs; the clock stands still when nothing does.
// It turns only on what is working right now: a running agent, a working
// session, the step in progress while a turn runs. What waits, idles or is
// done keeps a still mark.
export const FRAME_MS = 100
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// 950, 9.5k, 45k, 1.2M: a decimal only where a count has two digits or
// fewer, and none that would round up to the next unit.
export function tokenNumber(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens)
  }
  if (tokens < 9_950) {
    return `${(tokens / 1000).toFixed(1)}k`
  }

  return tokens < 999_500 ? `${Math.round(tokens / 1000)}k` : `${(tokens / 1_000_000).toFixed(1)}M`
}

// The fields that say what a call is on, in the order they are looked for:
// a command, a file, a pattern, an address, a query, a task.
export const CALL_FIELDS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'subject', 'prompt']

// What a call is on, from the first of those fields it has: its first line.
export function describeCall(input: unknown): string | undefined {
  const fields = isRecord(input) ? input : {}
  for (const name of CALL_FIELDS) {
    const value = fields[name]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().split('\n')[0]
    }
  }

  return undefined
}

// Text is measured in code points, one cell each for the glyphs this pane
// draws; a wide character in a prompt can overrun by a cell.
export function cells(text: string): number {
  return [...text].length
}

// Cut to `width` cells, an ellipsis marking the cut.
export function fit(text: string, width: number): string {
  const chars = [...text]
  if (chars.length <= width) {
    return text
  }

  return width <= 0 ? '' : `${chars.slice(0, width - 1).join('')}…`
}

// Cut from the start, for a path: its end is what tells files apart.
export function fitStart(text: string, width: number): string {
  const chars = [...text]
  if (chars.length <= width) {
    return text
  }

  return width <= 0 ? '' : `…${chars.slice(chars.length - width + 1).join('')}`
}

// Word-wrapped to `width`, at most `limit` lines, the last ending in an
// ellipsis when there was more. A word longer than a line is split.
export function wrap(text: string, width: number, limit = Infinity): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(part => part !== '')) {
    const joined = line === '' ? word : `${line} ${word}`
    if (cells(joined) <= width) {
      line = joined
      continue
    }
    if (line !== '') {
      lines.push(line)
    }
    let rest = [...word]
    while (rest.length > width) {
      lines.push(rest.slice(0, width).join(''))
      rest = rest.slice(width)
    }
    line = rest.join('')
  }
  if (line !== '') {
    lines.push(line)
  }
  if (lines.length <= limit) {
    return lines
  }

  const kept = lines.slice(0, limit)
  const last = kept[limit - 1] ?? ''
  kept[limit - 1] = cells(last) < width ? `${last}…` : fit(last, width)

  return kept
}

export function clip(lines: string[], count: number): string[] {
  if (lines.length <= count) {
    return lines
  }

  return count <= 0 ? [] : [...lines.slice(0, count - 1), '…']
}

export function spin(at: number): string {
  return SPINNER[Math.floor(at / FRAME_MS) % SPINNER.length] ?? '◐'
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }

  const wholeMinutes = Math.floor(seconds / 60)
  if (wholeMinutes < 60) {
    return `${wholeMinutes}m${String(seconds % 60).padStart(2, '0')}s`
  }

  return `${Math.floor(wholeMinutes / 60)}h${String(wholeMinutes % 60).padStart(2, '0')}m`
}

// A running time on a row, by the minute, so the row stands still: <1m, 4m,
// 1h05m. A finished one keeps its seconds (duration), as it no longer moves.
export function minutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000))
  if (total < 1) {
    return '<1m'
  }

  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}m`
}

// A model id as people say it: "claude-haiku-5-5" is "Haiku 5.5"; any other
// id stays as it is.
export function modelName(id: string): string {
  const [, family = '', major = '', minor] = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?=-|$)/.exec(id) ?? []
  if (family === '') {
    return id
  }

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

// A folder under the home folder from ~: "/home/demo/code" is "~/code", while
// "/home/demox" stays as it is.
export function tildePath(path: string, home: string): string {
  if (home === '' || (path !== home && !path.startsWith(`${home}/`))) {
    return path
  }

  return `~${path.slice(home.length)}`
}

// mcp__server__tool reads as tool.
export function toolName(tool: string): string {
  return tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') : tool
}

// A parsed JSON value's fields, when it is an object.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// The first line of what a process printed, or undefined when it printed none.
export function firstLine(text: string | undefined): string | undefined {
  const line = text?.trim().split('\n')[0]

  return line === undefined || line === '' ? undefined : line
}
