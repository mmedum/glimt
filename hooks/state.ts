// What glimt's modules share: the pane's id, and the few values they share
// as they run. The values drawing reads stay in register.tsx.

export const PANE = 'glimt'

// A toggle drawn in the pane and what it opens, in the order j and k walk.
export type Toggle = { key: string; target: string }

// The values glimt's modules share as they run: the toggles in the order
// last drawn (for j and k), whether the pane held the keyboard when last
// drawn, the home folder and Claude Code's own folder,
// whether anything runs (so the clock knows to move) and how many frames
// have passed, what this session last shared, and when, how many calls it
// has seen start (each running call's id), and whether its notifications are
// on (the `notifications` option).
export const runtime = {
  toggles: [] as Toggle[],
  isFocused: false,
  home: '',
  configDir: '',
  isBusy: false,
  ticks: 0,
  lastShared: '',
  lastSharedAt: 0,
  calls: 0,
  notifies: true,
}
