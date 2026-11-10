/**
 * Contract of the shipped browser artifact: registration shape, exported
 * surface, CSS injection, and the three registrations the plugin performs.
 *
 * Everything here runs against `lib/client.js` as published — no re-implementation.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply as hostApply } from '../lib/index.js'
import {
  CSS_ROOT_CLASS,
  PLUGIN_ID,
  loadArtifact,
} from './harness.mjs'

const artifact = loadArtifact()

test('产物只调用一次 window.__ModuleLoader__.load', () => {
  assert.equal(artifact.registrations.length, 1)
  assert.equal(typeof artifact.registration.factory, 'function')
})

test('注册 id === "dsh-turn-summary"', () => {
  assert.equal(artifact.registration.id, PLUGIN_ID)
})

test('factory 返回的 exports 恰好含 apply 与 inject', () => {
  assert.deepEqual(Object.keys(artifact.exports).sort(), ['apply', 'inject'])
  assert.equal(typeof artifact.exports.apply, 'function')
})

test('inject 精确等于 ["slots","locale","uiConversation"]', () => {
  assert.deepEqual(artifact.exports.inject, ['slots', 'locale', 'uiConversation'])
})

test('exports 带 Symbol.toStringTag === "Module"', () => {
  assert.equal(artifact.exports[Symbol.toStringTag], 'Module')
})

test('产物只请求 "react/jsx-runtime"', () => {
  assert.deepEqual(artifact.requested, ['react/jsx-runtime'])
})

test('注入的 <style> 带 data-plugin === "dsh-turn-summary"', () => {
  assert.equal(artifact.document.styles.length, 1)
  assert.equal(artifact.document.styles[0].tagName, 'style')
  assert.equal(artifact.document.styles[0].dataset.plugin, PLUGIN_ID)
})

test('注入的 <style> 带非空 data-plugin-css', () => {
  const cssId = artifact.document.styles[0].dataset.pluginCss
  assert.equal(typeof cssId, 'string')
  assert.ok(cssId.length > 0, 'data-plugin-css 不得为空')
  assert.equal(cssId, 'dsh-turn-summary/TurnSummaryLine.module.css')
})

test('注入的 CSS 文本含产物实际的哈希类名', () => {
  assert.ok(artifact.document.styles[0].textContent.includes(`.${CSS_ROOT_CLASS}`))
})

test('装配第一件事：ctx.locale.register 被调用一次，命名空间为 "turnSummary"', () => {
  const { localeRegistrations } = artifact.context
  assert.equal(localeRegistrations.length, 1)
  assert.equal(localeRegistrations[0].namespace, 'turnSummary')
})

test('字典含 zh/en/ja/es/fr/de/ru/pt 八个语言键', () => {
  const { dictionary } = artifact.context.localeRegistrations[0]
  assert.deepEqual(Object.keys(dictionary), ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])
})

test('八种语言的键集完全一致（各 6 个键）', () => {
  const { dictionary } = artifact.context.localeRegistrations[0]
  const expected = Object.keys(dictionary.zh)
  assert.deepEqual(expected, [
    'line', 'line.withPlugins', 'none', 'unreadable', 'separator', 'toolCount',
  ])
  for (const language of Object.keys(dictionary)) {
    assert.deepEqual(Object.keys(dictionary[language]), expected, `${language} 键集不一致`)
  }
})

test('装配第二件事：ctx.uiConversation.events.register 被调用一次', () => {
  assert.equal(artifact.context.definitionRegistrations.length, 1)
})

test('注册的 Definition kind === "turn-summary"', () => {
  assert.equal(artifact.context.definitionRegistrations[0].kind, 'turn-summary')
})

test('Definition 的 match 只覆盖 turn/start、tool/call、turn/end 三类', () => {
  const { match } = artifact.context.definitionRegistrations[0]
  assert.deepEqual(Object.keys(match).sort(), ['tool/call', 'turn/end', 'turn/start'])
  for (const matcher of Object.values(match)) assert.equal(typeof matcher, 'function')
})

test('装配第三件事：ctx.slots.inject 注册 conversation.chat.turnTail', () => {
  const { slotInjections } = artifact.context
  assert.equal(slotInjections.length, 1)
  assert.equal(slotInjections[0].name, 'conversation.chat.turnTail')
  assert.equal(typeof slotInjections[0].factory, 'function')
})

test('槽位注册项为 {name,id,order,locale} 且取值正确', () => {
  const { slotRegistrations } = artifact.context
  assert.equal(slotRegistrations.length, 1)
  assert.deepEqual(slotRegistrations[0].row, {
    name: 'conversation.chat.turnTail',
    id: 'dsh-turn-summary',
    order: 10,
    locale: 'turnSummary',
  })
  assert.equal(typeof slotRegistrations[0].component, 'function')
})

test('装配过程经由 ctx.effect 包裹字典与 Definition 两处注册', () => {
  assert.equal(artifact.context.effects.length, 2)
  assert.deepEqual(
    artifact.context.effects.map((effect) => effect.label),
    ['ui-turn-summary: dictionaries', 'ui-turn-summary: conversation definition'],
  )
})

test('host 半部 apply() 是空实现，调用后无副作用', () => {
  assert.equal(typeof hostApply, 'function')
  assert.equal(hostApply(), undefined)
  assert.equal(hostApply.length, 0)
})
