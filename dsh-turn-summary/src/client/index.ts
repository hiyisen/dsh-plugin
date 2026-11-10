/**
 * Browser half of the fixed per-Turn summary plugin. It registers one
 * Conversation Definition and one `conversation.chat.turnTail` list entry.
 * The Definition folds `turn/start` and `tool/call` from the Session events the
 * Client already received; the entry renders the folded value. Nothing here
 * creates a Session event, a tool, a prompt section, or a model request, and
 * the model is never asked to report its own usage.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Conversation service merge (ctx.uiConversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-chat's SlotMap declaration of the Turn-tail hole.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { TurnSummaryLine } from './TurnSummaryLine.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type TurnSummaryKey } from './locales.ts'
import { NO_TOOL_OWNERS, TURN_SUMMARY_ENTRY_ID } from './summary-fold.ts'
import { createTurnSummaryDefinition } from './turn-summary-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy of the fixed per-Turn summary line. */
    turnSummary: TurnSummaryKey
  }
}

/** Required services: dictionaries, the Conversation Definition registry, and slots. */
export const inject = ['slots', 'locale', 'uiConversation']

/**
 * Register the dictionaries, the Turn-scoped Definition, and the fixed line.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-turn-summary: dictionaries')

  // Step one has no client-visible tool-to-plugin map. The resolver is the
  // honest seam a Host-authored static map can implement at boot in step two;
  // it still never reaches a model request or the Session log.
  const definition = createTurnSummaryDefinition(NO_TOOL_OWNERS)
  const match = definition.match.bind(definition)
  ctx.effect(() => ctx.uiConversation.events.register({
    ...definition,
    match: {
      'turn/start': match,
      'tool/call': match,
      'turn/end': match,
    },
  }), 'ui-turn-summary: conversation definition')

  // The Turn tail renders outside the collapsible Tool group, so the line is
  // always visible without a click, an expanded card, or a changed tab.
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: TURN_SUMMARY_ENTRY_ID,
    order: 10,
    locale: NS,
  }, TurnSummaryLine))
}
