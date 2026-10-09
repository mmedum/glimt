// The keys and the forms: the key row, the key list i opens, this session's
// row, and the form n, s and r open.

import type { Composer, Session } from '../types'
import { runtime } from './state'
import { cells, fit, fitStart, tildePath } from './text'
import { keyButton, keyWidth, wrappedRows } from './view'
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

export type SelfState = { session: Session | undefined; isOpen: boolean; isClearing: boolean; answer: (isYes: boolean) => void }

// This session at the top: its name, opened its folder and id, and after c
// the question whether to clear the conversation.
export function selfSection(view: View, state: SelfState) {
  const { Box, Button, Text } = view.ui
  const { session, isOpen, isClearing } = state
  // Until the session list names it, the row just says what it is.
  const name = session?.name
  const where = session === undefined ? '' : tildePath(session.cwd, runtime.home)

  return {
    rows: 1 + (isOpen && session !== undefined ? 1 : 0) + (isClearing ? 1 : 0),
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
        {isOpen && session !== undefined && (
          <Text dimColor>
            {'  ⎿ '}
            {fitStart(`${where} · ${session.id ?? session.sessionId}`, view.columns - 4)}
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
