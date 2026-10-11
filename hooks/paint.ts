// A color option, as Claude Code's custom themes spell a color, turned into
// one a Text paints: a theme role by name, hex, or one of the terminal's 256
// colors by number.

// Claude Code's theme roles, which follow the person's theme: every token its
// custom theme reference lists.
const ROLES = new Set([
  'text',
  'inverseText',
  'inactive',
  'subtle',
  'suggestion',
  'remember',
  'success',
  'error',
  'warning',
  'merged',
  'claude',
  'permission',
  'planMode',
  'autoAccept',
  'promptBorder',
  'bashBorder',
  'ide',
  'diffAdded',
  'diffRemoved',
  'diffAddedDimmed',
  'diffRemovedDimmed',
  'diffAddedWord',
  'diffRemovedWord',
  'fastMode',
  'effortUltra',
  'userMessageBackground',
  'userMessageBackgroundHover',
  'bashMessageBackgroundColor',
  'memoryBackgroundColor',
  'selectionBg',
  'rate_limit_fill',
  'rate_limit_empty',
  'briefLabelYou',
  'briefLabelClaude',
  ...['claude', 'warning', 'permission', 'promptBorder', 'inactive', 'fastMode'].map(role => `${role}Shimmer`),
  ...['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'].map(color => `${color}_FOR_SUBAGENTS_ONLY`),
  ...['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'].flatMap(color => [`rainbow_${color}`, `rainbow_${color}_shimmer`]),
])

// The terminal's sixteen colors as Text names them, in ANSI order, which
// numbers them for `ansi256(n)`; gray, in either spelling, is blackBright.
const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
]
const NUMBERS = new Map<string, number>([...ANSI.map((name, n) => [name, n] as const), ['gray', 8], ['grey', 8]])

const hex = (...channels: number[]) => `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`

// The option's color, or `fallback` for one it can't read: a theme role,
// a color name, `#rgb` or `#rrggbb`, `rgb(r, g, b)`, `ansi256(n)` or
// `ansi:<name>`, as a custom theme takes them. A color name, bare or after
// `ansi:`, comes back by its number as `ansi256(n)`, which Claude Code draws
// in the terminal's own palette: it draws a bare name as a fixed hex, and
// refuses a colon in a Text color.
export function colorOf(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const color = value.trim()
  if (ROLES.has(color)) {
    return color
  }
  const named = NUMBERS.get(color.startsWith('ansi:') ? color.slice('ansi:'.length) : color)
  if (named !== undefined) {
    return `ansi256(${named})`
  }
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    return color.toLowerCase()
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color)
  if (rgb !== null) {
    const channels = rgb.slice(1).map(Number)
    return channels.every(channel => channel <= 255) ? hex(...channels) : fallback
  }
  const indexed = /^ansi256\(\s*(\d{1,3})\s*\)$/.exec(color)
  if (indexed !== null) {
    const n = Number(indexed[1])
    return n <= 255 ? `ansi256(${n})` : fallback
  }

  return fallback
}
