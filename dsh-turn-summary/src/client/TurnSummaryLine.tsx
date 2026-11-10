/** The fixed, non-collapsible one-line summary beneath each completed reply. */
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-chat's SlotMap declaration of `conversation.chat.turnTail`.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnSummary } from './types.ts'
import css from './TurnSummaryLine.module.css'

/** Props the Turn-tail list seat supplies to this row. */
export type TurnSummaryLineProps =
  Pick<PropsRuntime<'conversation.chat.turnTail'>, 'turn'> & PropsLocale<'turnSummary'>

/** Facts of a Turn that has published no summary yet. */
const EMPTY_SUMMARY: Readonly<TurnSummary> = {
  turn: 0,
  skillCallCount: 0,
  skillNames: [],
  unreadableSkillCalls: 0,
  pluginNames: [],
  toolCounts: [],
}

/**
 * Compose the visible line from folded facts and the active dictionary.
 * @param summary - published Turn facts, or undefined before the first publication.
 * @param t - turn-summary dictionary translator.
 * @returns the complete one-line text, explicitly naming empty categories.
 */
export function summaryText(
  summary: Readonly<TurnSummary> | undefined,
  t: TranslateNS<'turnSummary'>,
): string {
  const value = summary ?? EMPTY_SUMMARY
  const separator = t('separator')
  const skillNames = [...value.skillNames]
  if (value.unreadableSkillCalls > 0) skillNames.push(t('unreadable'))
  const skill = value.skillCallCount === 0
    ? t('none')
    : skillNames.length > 0 ? skillNames.join(separator) : t('unreadable')
  const tools = value.toolCounts.length === 0
    ? t('none')
    : value.toolCounts
      .map(tool => t('toolCount', { name: tool.name, count: tool.count }))
      .join(separator)
  if (value.pluginNames.length === 0) return t('line', { skill, tools })
  return t('line.withPlugins', { skill, plugins: value.pluginNames.join(separator), tools })
}

/**
 * Render one always-visible line per completed Turn. The Turn tail is a list
 * seat outside the Turn's process disclosure, so the line stays visible while
 * the Tool group is collapsed; it has no open state, button, or command.
 * @param props - enclosing Turn and the active dictionary.
 * @returns the fixed summary row.
 */
export function TurnSummaryLine({ turn, t }: TurnSummaryLineProps) {
  const summary = turn.data.get('turn-summary')
  return (
    <div
      className={css.root}
      data-turn-summary={turn.turn}
      data-turn-summary-skill-calls={summary?.skillCallCount ?? 0}
      data-turn-summary-tool-calls={summary?.toolCounts.reduce((total, tool) => total + tool.count, 0) ?? 0}
    >
      {summaryText(summary, t)}
    </div>
  )
}
