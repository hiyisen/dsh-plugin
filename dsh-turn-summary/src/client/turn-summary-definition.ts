/**
 * One Conversation Definition per Turn: it reads `turn/start` and `tool/call`
 * from the Client's existing event stream, folds them with the pure helpers,
 * and publishes the result as Turn Location data. It declares no view target
 * and no view Node, so it adds no Chat row; the Turn-tail list seat reads the
 * published value through `turn.data.get('turn-summary')`.
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ToolOwnerResolver, TurnSummary, TurnSummaryEvent, TurnSummaryState,
} from './types.ts'
import {
  TURN_SUMMARY_DATA_KEY, TURN_SUMMARY_DEFINITION_KIND, emptyTurnSummaryState,
  foldTurnSummaryEvent, sameTurnSummary, toTurnSummary,
} from './summary-fold.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Browser-folded skill, plugin, and tool usage of this Turn. */
    'turn-summary': TurnSummary
  }
}

/** The Session event face the Conversation engine hands a Definition. */
type ConversationEvent = Parameters<ConversationNodeDefinition['match']>[0]

/**
 * Narrow one real Session event to the facts this fold consumes.
 * @param event - durable or transient Client event.
 * @returns the adapted event; unrelated events become `ignored`.
 */
export function toTurnSummaryEvent(event: ConversationEvent): TurnSummaryEvent {
  switch (event.type) {
    case 'turn/start':
      return { type: 'turn/start', seq: event.seq, turn: event.data.turn }
    case 'turn/end':
      return { type: 'turn/end', seq: event.seq, turn: event.data.turn }
    case 'tool/call':
      return {
        type: 'tool/call',
        seq: event.seq,
        turn: event.data.turn,
        name: event.data.name,
        arguments: event.data.arguments,
      }
    default:
      return { type: 'ignored', seq: event.seq }
  }
}

/**
 * Build the Definition for one attribution resolver.
 * @param owners - tool-to-plugin attribution; unknown owners in step one.
 * @returns a state-only Conversation Definition publishing one Turn's summary.
 */
export function createTurnSummaryDefinition(
  owners: ToolOwnerResolver,
): ConversationNodeDefinition<TurnSummaryState> {
  return {
    kind: TURN_SUMMARY_DEFINITION_KIND,
    match: (event) => {
      if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
      if (event.type === 'tool/call' || event.type === 'turn/end') {
        return { id: String(event.data.turn), role: 'update' }
      }
      return null
    },
    start: (_context, match) => {
      const event = toTurnSummaryEvent(match.event)
      /* v8 ignore next 2 -- the engine calls start only for the turn/start match this Definition returns. */
      if (event.type !== 'turn/start') throw new Error('turn-summary start requires turn/start')
      return emptyTurnSummaryState(event.turn, event.seq)
    },
    update: (context, match) => foldTurnSummaryEvent(context.state, toTurnSummaryEvent(match.event)),
    buildLocationData: (context, scope, previous) => {
      if (scope !== 'turn' || context.state === undefined) return null
      const value = toTurnSummary(context.state, owners)
      if (previous?.kind === 'turn'
        && previous.key === TURN_SUMMARY_DATA_KEY
        && previous.turn === value.turn
        && sameTurnSummary(previous.value, value)) return previous
      return { kind: 'turn', turn: value.turn, key: TURN_SUMMARY_DATA_KEY, value }
    },
  }
}
