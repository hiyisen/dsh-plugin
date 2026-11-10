/** Data contracts of the fixed per-Turn summary line. This module holds types only. */

/** One tool name and how many `tool/call` events it received in one Turn. */
export interface ToolCount {
  /** Wire tool name, truncated for display. */
  readonly name: string
  /** Number of calls in this Turn. */
  readonly count: number
}

/** Immutable facts folded in the browser and published against one Turn Location. */
export interface TurnSummary {
  /** Turn number the facts belong to. */
  readonly turn: number
  /** Number of `skill` tool calls, including calls whose name could not be read. */
  readonly skillCallCount: number
  /** Distinct skill names in first-load order. */
  readonly skillNames: readonly string[]
  /** `skill` calls whose arguments could not be parsed for a name. */
  readonly unreadableSkillCalls: number
  /** Plugin names attributed to this Turn's tools; empty when no attribution is available. */
  readonly pluginNames: readonly string[]
  /** Non-skill tool calls grouped by name in first-use order. */
  readonly toolCounts: readonly ToolCount[]
}

/**
 * Tool-to-plugin attribution. The Client has no tool-to-plugin map today; a
 * Host-authored static map can implement this resolver at browser boot later,
 * still without a model request or a Session event. Returning an empty list
 * states that ownership is unknown and keeps the plugin field out of the line.
 */
export interface ToolOwnerResolver {
  /**
   * Resolve the plugins owning one wire tool name.
   * @param toolName - tool name recorded on `tool/call`.
   * @returns owning plugin names, or an empty list when attribution is unknown.
   */
  ownersOf(toolName: string): readonly string[]
}

/** Minimal event view the pure fold consumes; the Definition adapts real events to it. */
export type TurnSummaryEvent =
  | { readonly type: 'turn/start'; readonly seq: number; readonly turn: number }
  | { readonly type: 'turn/end'; readonly seq: number; readonly turn: number }
  | {
    readonly type: 'tool/call'
    readonly seq: number
    readonly turn: number
    readonly name: string
    readonly arguments: string
  }
  | { readonly type: 'ignored'; readonly seq: number }

/** Accumulated state of one Turn inside the Conversation Definition. */
export interface TurnSummaryState {
  /** Turn number this state belongs to. */
  readonly turn: number
  /** Sequence of this Turn's `turn/start`; earlier events belong to inherited history. */
  readonly startSeq: number
  /** Number of `skill` tool calls observed. */
  readonly skillCallCount: number
  /** Distinct readable skill names in first-load order. */
  readonly skillNames: readonly string[]
  /** `skill` calls whose arguments could not be parsed for a name. */
  readonly unreadableSkillCalls: number
  /** Non-skill tool calls grouped by name in first-use order. */
  readonly toolCounts: readonly ToolCount[]
}
