// The keys and the forms: the key row, the key list i opens, this session's
// row, and the form n, s and r open.

import type { Composer, Limit, ModelUse, Session } from '../types'
import { runtime } from './state'
import { LIMIT_LOUD, LIMIT_SHOWN, limitText } from './sessions'
import { cells, fit, fitParts, fitStart, minutes, modelName, tildePath } from './text'
import type { Part } from './text'
import { keyButton, keyWidth, partsNode, wrappedRows } from './view'
import type { View } from './view'

export type Keys = Record<'down' | 'up' | 'into' | 'back' | 'open' | 'spawn' | 'help' | 'rename' | 'clear' | 'attach' | 'stop', () => void>

// What the cursor is on allows: o on any row, c on this session, r on this
// session or one whose glimt shares, a and x on a background session, x on
// an agent of this session that runs in the background.
export type KeyContext = { canOpen: boolean; canClear: boolean; canRename: boolean; canReach: boolean; canStop: boolean }

// The keys while the pane holds the keyboard: moving, n, and i for the full
// list always; the rest only where the cursor's row allows them, so the row
// stays short. A key works only while drawn, so s and q live in the list.
// Paired keys sit close and groups apart. Up, Down, Tab and Enter work as
// they do everywhere.
export function keySection(view: View, can: KeyContext, keys: Keys) {
  const { Box } = view.ui
  const key = (name: string, hotkey: string, label: string, press: () => void) => keyButton(view, name, hotkey, label, press)
  const pair = keyWidth('↓') + 1 + keyWidth('↑')
  const labels = [
    can.canOpen && 'open',
    can.canRename && 'rename',
    can.canClear && 'clear',
    can.canReach && 'attach',
    (can.canReach || can.canStop) && 'stop',
    'new',
    'keys',
  ].filter((label): label is string => label !== false)

  return {
    rows: wrappedRows([pair, pair, ...labels.map(keyWidth)], view.columns, 3),
    node: (
      <Box key="keys" flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Box flexDirection="row" columnGap={1}>
          {key('down', 'j', '↓', keys.down)}
          {key('up', 'k', '↑', keys.up)}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {key('back', 'h', '←', keys.back)}
          {key('into', 'l', '→', keys.into)}
        </Box>
        {can.canOpen && key('open', 'o', 'open', keys.open)}
        {can.canRename && key('rename', 'r', 'rename', keys.rename)}
        {can.canClear && key('clear', 'c', 'clear', keys.clear)}
        {can.canReach && key('attach', 'a', 'attach', keys.attach)}
        {(can.canReach || can.canStop) && key('stop', 'x', 'stop', keys.stop)}
        {key('spawn', 'n', 'new', keys.spawn)}
        {key('help', 'i', 'keys', keys.help)}
      </Box>
    ),
  }
}

// What each key does, for the list i opens; the keys that start something or
// close the pane are pressable there.
export const KEY_LIST: readonly (readonly [string, string])[] = [
  ['j k', 'move down and up (↓ ↑ and Tab too)'],
  ['l', 'go into an agent or a session'],
  ['h', 'back out'],
  ['o', 'open or close the row'],
  ['r', 'rename this session, or one running glimt'],
  ['c', 'clear this conversation'],
  ['m', 'write to the agent or session you are in'],
  ['a', "copy a background session's attach command"],
  ['x', 'stop a background session or agent'],
]

export type HelpActions = { spawn: () => void; session: () => void; close: () => void; back: () => void }

// i: every key and what it does, under the name and where it lives, in
// place of the pane's body; n, s and q work from here, i goes back.
export function helpSection(view: View, act: HelpActions) {
  const { Box, Button, Text } = view.ui
  const line = (keys: string, what: string) => (
    <Text>
      <Text color="claude">{keys}</Text>
      {fit(`: ${what}`, view.columns - cells(keys))}
    </Text>
  )

  return (
    <Box key="help" flexDirection="column">
      <Text dimColor>{fit('glimt · github.com/mmedum/glimt', view.columns)}</Text>
      <Box key="help-keys" flexDirection="column" marginTop={1}>
        {KEY_LIST.map(([keys, what]) => line(keys, what))}
        <Button key="help-spawn" plain hotkey="n" label="new agent here" onPress={act.spawn} />
        <Button key="help-session" plain hotkey="s" label="new background session" onPress={act.session} />
        <Button key="help-close" plain hotkey="q" label="close the pane" onPress={act.close} />
      </Box>
      <Box key="keys" marginTop={1}>
        {keyButton(view, 'help', 'i', 'back', act.back)}
      </Box>
    </Box>
  )
}

// What this session's rows say beside its name: the permission mode as last
// seen, the plan's limits, whether another session runs in its folder, and
// the main conversation's model and effort.
export type SelfState = {
  session: Session | undefined
  isOpen: boolean
  isClearing: boolean
  answer: (isYes: boolean) => void
  mode: string | null
  limits: Limit[]
  isSameFolder: boolean
  engine: ModelUse | null
}

// The status row under this session's name, empty while all is usual:
// bypass permissions in amber, each limit window from LIMIT_SHOWN (the
// fullest first, with when it resets), another session in the same folder.
// Short of room, when it resets goes first, then the other windows, then
// the folder.
export function selfStatus(view: View, state: SelfState): Part[] {
  const shown = state.limits.filter(limit => limit.percentUsed >= LIMIT_SHOWN).toSorted((a, b) => b.percentUsed - a.percentUsed)
  const resets = shown[0]?.resetsAt === undefined ? Number.NaN : Date.parse(shown[0].resetsAt)
  const parts: Part[] = [
    ...(state.mode === 'bypassPermissions' ? [{ text: view.columns < 36 ? 'bypass' : 'bypass permissions', color: 'warning', rank: 9 }] : []),
    ...shown.flatMap((limit, i) => [
      { text: limitText(limit), isBold: limit.percentUsed >= LIMIT_LOUD, rank: i === 0 ? 8 : 6 - i },
      ...(i === 0 && !Number.isNaN(resets) ? [{ text: `resets in ${minutes(resets - view.at)}`, rank: 1 }] : []),
    ]),
    ...(state.isSameFolder ? [{ text: 'same folder', rank: 7 }] : []),
  ]

  return fitParts(parts, view.columns - 2)
}

// This session at the top: its name, under it the status row while it has
// something to say, opened its folder, model, effort and id, and after c the
// question whether to clear the conversation.
export function selfSection(view: View, state: SelfState) {
  const { Box, Button, Text } = view.ui
  const { session, isOpen, isClearing, engine } = state
  // Until the session list names it, the row just says what it is.
  const name = session?.name
  const where = session === undefined ? '' : tildePath(session.cwd, runtime.home)
  const status = selfStatus(view, state)
  const use = engine === null ? '' : ` · ${modelName(engine.model)}${engine.effort === undefined ? '' : ` · ${engine.effort} effort`}`

  return {
    rows: 1 + (status.length > 0 ? 1 : 0) + (isOpen && session !== undefined ? 1 : 0) + (isClearing ? 1 : 0),
    node: (
      <Box key="self" flexDirection="column">
        <Box flexDirection="row">
          <Button key="toggle-self" plain label={isOpen ? '▾' : '▸'} onPress={() => view.toggle('self')} />
          <Text>
            {' '}
            <Text bold inverse={view.cursor === 'toggle-self'}>
              {fit(name ?? 'this session', view.columns - 16)}
            </Text>
            {name !== undefined && <Text dimColor>{'  this session'}</Text>}
          </Text>
        </Box>
        {status.length > 0 && (
          <Box key="self-status" paddingLeft={2}>
            {partsNode(view, status)}
          </Box>
        )}
        {isOpen && session !== undefined && (
          <Text dimColor>
            {'  ⎿ '}
            {fitStart(`${where}${use} · ${session.id ?? session.sessionId}`, view.columns - 4)}
          </Text>
        )}
        {isClearing && (
          <Box key="clear-ask" flexDirection="row" columnGap={2} paddingLeft={2}>
            <Text color="warning">Clear this conversation?</Text>
            <Button key="clear-yes" plain hotkey="y" label="yes" onPress={() => state.answer(true)} />
            <Button key="clear-no" plain hotkey="n" label="no" onPress={() => state.answer(false)} />
          </Box>
        )}
      </Box>
    ),
  }
}

export type ComposerActions = {
  spawn: (task: string, where: 'here' | 'session') => void
  rename: (sessionId: string, name: string) => void
  cancel: () => void
}

// The rows the form takes, the blank above it included.
export const FORM_ROWS = 3

// The form n, s or r opens, where the keys were, so nothing else moves: a
// task for a new agent here (n) or in a new background session (s), or a new
// name for a session (r). Its label says which, so nothing is left to choose.
// Its field holds the keyboard: Enter starts, Enter on an empty field or
// leaving it (Tab, or a click on cancel) closes it.
export function composerSection(view: View, form: Composer, list: Session[], act: ComposerActions) {
  const { Box, Button, Text } = view.ui
  const { Input } = view
  if (Input === undefined) {
    return <Text dimColor>Typing here needs the terminal or the desktop app.</Text>
  }

  const isSpawn = form.kind === 'spawn'
  const name = isSpawn ? '' : (list.find(s => s.sessionId === form.sessionId)?.name ?? 'the session')
  const verb = isSpawn ? 'start' : 'rename'
  return (
    <Box key="composer" flexDirection="column">
      <Input
        key="composer-field"
        label={isSpawn ? (form.where === 'here' ? 'New agent' : 'New session') : `Rename ${fit(name, 24)}`}
        placeholder={isSpawn ? 'What should it do?' : 'New name'}
        value=""
        submitLabel={verb}
        autoFocus
        onSubmit={text => (isSpawn ? act.spawn(text, form.where) : act.rename(form.sessionId, text))}
      />
      <Box flexDirection="row" columnGap={3}>
        <Text dimColor>{`↵ ${verb}`}</Text>
        <Button key="composer-cancel" plain dimColor label="tab cancel" onPress={act.cancel} />
      </Box>
    </Box>
  )
}
