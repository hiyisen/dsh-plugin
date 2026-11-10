/**
 * Pure fold over the Session events the Client already received. No React, no
 * Cordis, no Remote, no model call: every function here is a deterministic
 * function of its arguments and can be replayed from a recorded Session log.
 */
import type {
  ToolCount, ToolOwnerResolver, TurnSummary, TurnSummaryEvent, TurnSummaryState,
} from './types.ts'

/** Wire tool name of a skill load. */
export const SKILL_TOOL_NAME = 'skill'

/** Conversation Location data key this plugin publishes for one Turn. */
export const TURN_SUMMARY_DATA_KEY = 'turn-summary'

/** Conversation Definition kind that folds one Turn's calls. */
export const TURN_SUMMARY_DEFINITION_KIND = 'turn-summary'

/** Identity of the `conversation.chat.turnTail` list entry owned by this plugin. */
const TURN_TAIL_ROW_KEY = 'dsh-turn-summary'

/** Public name kept stable for the plugin entry and its consumers. */
export { TURN_TAIL_ROW_KEY as TURN_SUMMARY_ENTRY_ID }

/** Upper bound on the `skill` arguments JSON this fold parses, in UTF-16 code units. */
export const MAX_SKILL_ARGUMENT_CHARS = 4096

/** Upper bound on one retained display name, in Unicode code points. */
export const MAX_NAME_CHARS = 120

/** Upper bound on distinct skill names retained for one Turn. */
export const MAX_SKILL_NAMES = 16

/**
 * Step-one owner resolver: the Client has no tool-to-plugin map, so every
 * lookup honestly reports an unknown owner instead of inventing one.
 */
export const NO_TOOL_OWNERS: ToolOwnerResolver = {
  ownersOf: () => [],
}

/**
 * Trim and bound one wire or user-supplied name.
 * @param value - raw name.
 * @returns a bounded name, empty when the raw name carries no visible text.
 */
function boundedName(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_NAME_CHARS).join('')
}

/**
 * Read a skill name from a `skill` tool call's JSON arguments.
 * @param argumentsText - the `arguments` string recorded on `tool/call`.
 * @returns the bounded skill name, or undefined when the call names none.
 */
export function skillNameOf(argumentsText: string): string | undefined {
  if (argumentsText.length > MAX_SKILL_ARGUMENT_CHARS) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  if (!('name' in parsed)) return undefined
  const name: unknown = parsed.name
  if (typeof name !== 'string') return undefined
  const bounded = boundedName(name)
  return bounded === '' ? undefined : bounded
}

/**
 * Create the empty state of one Turn.
 * @param turn - Turn number.
 * @param startSeq - sequence of this Turn's `turn/start`.
 * @returns state with no skills and no tool calls.
 */
export function emptyTurnSummaryState(turn: number, startSeq: number): TurnSummaryState {
  return {
    turn,
    startSeq,
    skillCallCount: 0,
    skillNames: [],
    unreadableSkillCalls: 0,
    toolCounts: [],
  }
}

/**
 * Increment one tool's counter, preserving first-use order.
 * @param counts - counters so far.
 * @param name - bounded tool name.
 * @returns a new counter list.
 */
function bumpTool(counts: readonly ToolCount[], name: string): readonly ToolCount[] {
  let found = false
  const next = counts.map((entry) => {
    if (entry.name !== name) return entry
    found = true
    return { name, count: entry.count + 1 }
  })
  return found ? next : [...counts, { name, count: 1 }]
}

/**
 * Fold one adapted event into a Turn's state. A `turn/start` resets the state,
 * so a fork's inherited history cannot contribute to the new Turn; events from
 * another Turn or before this Turn's start are ignored for the same reason.
 * @param state - current Turn state.
 * @param event - adapted event.
 * @returns the next Turn state.
 */
export function foldTurnSummaryEvent(
  state: TurnSummaryState,
  event: TurnSummaryEvent,
): TurnSummaryState {
  if (event.type === 'turn/start') return emptyTurnSummaryState(event.turn, event.seq)
  if (event.type === 'ignored' || event.type === 'turn/end') return state
  if (event.turn !== state.turn || event.seq < state.startSeq) return state
  const name = boundedName(event.name)
  if (name === '') return state
  if (name === SKILL_TOOL_NAME) {
    const skillName = skillNameOf(event.arguments)
    if (skillName === undefined) {
      return {
        ...state,
        skillCallCount: state.skillCallCount + 1,
        unreadableSkillCalls: state.unreadableSkillCalls + 1,
      }
    }
    const added = !state.skillNames.includes(skillName) && state.skillNames.length < MAX_SKILL_NAMES
    return {
      ...state,
      skillCallCount: state.skillCallCount + 1,
      ...added ? { skillNames: [...state.skillNames, skillName] } : {},
    }
  }
  return { ...state, toolCounts: bumpTool(state.toolCounts, name) }
}

/**
 * Collect the distinct plugin names attributed to this Turn's tools.
 * @param state - folded Turn state.
 * @param owners - attribution resolver.
 * @returns plugin names in first-attribution order.
 */
function pluginNamesOf(state: TurnSummaryState, owners: ToolOwnerResolver): readonly string[] {
  const names: string[] = []
  for (const tool of state.toolCounts) {
    for (const candidate of owners.ownersOf(tool.name)) {
      const name = boundedName(candidate)
      if (name !== '' && !names.includes(name)) names.push(name)
    }
  }
  return names
}

/**
 * Publish a Turn's folded facts as an immutable Location value.
 * @param state - folded Turn state.
 * @param owners - attribution resolver; unknown owners by default.
 * @returns the value the Turn-tail row renders.
 */
export function toTurnSummary(
  state: TurnSummaryState,
  owners: ToolOwnerResolver = NO_TOOL_OWNERS,
): TurnSummary {
  return {
    turn: state.turn,
    skillCallCount: state.skillCallCount,
    skillNames: state.skillNames,
    unreadableSkillCalls: state.unreadableSkillCalls,
    pluginNames: pluginNamesOf(state, owners),
    toolCounts: state.toolCounts,
  }
}

/**
 * Compare two published summaries field by field so an unchanged materialization
 * keeps its predecessor's identity.
 * @param left - previous value.
 * @param right - current value.
 * @returns whether both describe the same Turn facts.
 */
export function sameTurnSummary(
  left: Readonly<TurnSummary>,
  right: Readonly<TurnSummary>,
): boolean {
  return left.turn === right.turn
    && left.skillCallCount === right.skillCallCount
    && left.unreadableSkillCalls === right.unreadableSkillCalls
    && sameStrings(left.skillNames, right.skillNames)
    && sameStrings(left.pluginNames, right.pluginNames)
    && left.toolCounts.length === right.toolCounts.length
    && left.toolCounts.every((tool, index) => tool.name === right.toolCounts[index]?.name
      && tool.count === right.toolCounts[index]?.count)
}

/**
 * Compare two ordered name lists.
 * @param left - previous list.
 * @param right - current list.
 * @returns whether both lists hold the same names in the same order.
 */
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index])
}

/** Bounds a window fold to one Turn's events. */
export interface TurnSummaryWindowOptions {
  /** Lowest sequence still belonging to the current Turn; inherited history is excluded. */
  readonly fromSeq?: number
  /** Attribution resolver; unknown owners by default. */
  readonly owners?: ToolOwnerResolver
}

/**
 * Fold an ordered event window into one Turn's summary. Events before
 * `fromSeq` are inherited history (a fork replays its parent's log) and never
 * contribute; a `turn/start` inside the window starts a fresh Turn. A window
 * with no `turn/start` derives an empty state from its first in-window event,
 * so a paginated history page still reports an honest line.
 * @param events - adapted events in ascending sequence order.
 * @param options - lower sequence bound and attribution resolver.
 * @returns the Turn's folded summary, empty when the window has no relevant event.
 */
export function foldTurnSummaryWindow(
  events: readonly TurnSummaryEvent[],
  options: TurnSummaryWindowOptions = {},
): TurnSummary {
  const fromSeq = options.fromSeq ?? 0
  let state: TurnSummaryState | undefined
  for (const event of events) {
    if (event.seq < fromSeq) continue
    if (state === undefined) {
      if (event.type === 'turn/start') {
        state = emptyTurnSummaryState(event.turn, event.seq)
        continue
      }
      if (event.type === 'ignored' || event.type === 'turn/end') continue
      state = emptyTurnSummaryState(event.turn, fromSeq)
    }
    state = foldTurnSummaryEvent(state, event)
  }
  return toTurnSummary(state ?? emptyTurnSummaryState(0, fromSeq), options.owners)
}
