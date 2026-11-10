/** `turnSummary` namespace dictionaries for the fixed per-Turn line. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'turnSummary'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'line': '本轮 · skill: {skill} ｜ 工具: {tools}',
  'line.withPlugins': '本轮 · skill: {skill} ｜ 插件: {plugins} ｜ 工具: {tools}',
  'none': '无',
  'unreadable': '未知',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<string, string>

/** The turn-summary namespace key union. */
export type TurnSummaryKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'line': 'This turn · skill: {skill} | tools: {tools}',
  'line.withPlugins': 'This turn · skill: {skill} | plugins: {plugins} | tools: {tools}',
  'none': 'None',
  'unreadable': 'unknown',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<TurnSummaryKey, string>

/** Japanese dictionary, checked against the English keys. */
export const ja = {
  'line': '本ラウンド · skill: {skill} ｜ ツール: {tools}',
  'line.withPlugins': '本ラウンド · skill: {skill} ｜ プラグイン: {plugins} ｜ ツール: {tools}',
  'none': 'なし',
  'unreadable': '不明',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'line': 'Esta ronda · skill: {skill} ｜ herramientas: {tools}',
  'line.withPlugins': 'Esta ronda · skill: {skill} ｜ complementos: {plugins} ｜ herramientas: {tools}',
  'none': 'Ninguno',
  'unreadable': 'desconocido',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'line': 'Ce tour · skill: {skill} ｜ outils: {tools}',
  'line.withPlugins': 'Ce tour · skill: {skill} ｜ plugins: {plugins} ｜ outils: {tools}',
  'none': 'Aucun',
  'unreadable': 'inconnu',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'line': 'Dieser Durchlauf · skill: {skill} ｜ Werkzeuge: {tools}',
  'line.withPlugins': 'Dieser Durchlauf · skill: {skill} ｜ Plugins: {plugins} ｜ Werkzeuge: {tools}',
  'none': 'Keine',
  'unreadable': 'unbekannt',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'line': 'Этот раунд · skill: {skill} ｜ инструменты: {tools}',
  'line.withPlugins': 'Этот раунд · skill: {skill} ｜ плагины: {plugins} ｜ инструменты: {tools}',
  'none': 'Нет',
  'unreadable': 'неизвестно',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'line': 'Esta rodada · skill: {skill} ｜ ferramentas: {tools}',
  'line.withPlugins': 'Esta rodada · skill: {skill} ｜ plugins: {plugins} ｜ ferramentas: {tools}',
  'none': 'Nenhum',
  'unreadable': 'desconhecido',
  'separator': ', ',
  'toolCount': '{name}×{count}',
} satisfies Record<keyof typeof en, string>
