/**
 * Contract of the published package: metadata, patch row, locale files, and the
 * byte-level drift guard between `lib/client.js.map` and the `src/` snapshot.
 *
 * Zero dependencies: the tiny YAML reader below only has to understand the flat
 * bundle-patch shape this package ships.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { PACKAGE_ROOT } from './harness.mjs'

const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

/**
 * Read the flat bundle-patch shape (`- insert:` / `- id:` / `name:`).
 * @param {string} text - the YAML source.
 * @returns {object} the parsed patch.
 */
function parsePatch(text) {
  const inserts = []
  let insideInsert = false
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (line.length - line.trimStart().length === 0 && trimmed.startsWith('- insert:')) {
      insideInsert = true
      continue
    }
    if (!insideInsert) continue
    if (trimmed.startsWith('- ')) {
      current = {}
      inserts.push(current)
      const rest = trimmed.slice(2)
      const separator = rest.indexOf(':')
      current[rest.slice(0, separator).trim()] = rest.slice(separator + 1).trim()
      continue
    }
    const separator = trimmed.indexOf(':')
    if (separator < 0 || !current) continue
    current[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }
  return { insert: inserts }
}

test('package.json 声明包名 dsh-turn-summary、版本 1.0.0', () => {
  assert.equal(packageJson.name, 'dsh-turn-summary')
  assert.equal(packageJson.version, '1.0.0')
  assert.equal(packageJson.type, 'module')
  assert.equal(packageJson.author, 'hiyisen')
  assert.equal(packageJson.license, 'MIT')
})

test('package.json 的 exports 指向真实存在的文件', () => {
  assert.equal(packageJson.exports['.'].default, './lib/index.js')
  assert.equal(packageJson.exports['./client'].default, './lib/client.js')
  assert.equal(packageJson.exports['./package.json'], './package.json')
  assert.ok(existsSync(join(PACKAGE_ROOT, 'lib', 'index.js')))
  assert.ok(existsSync(join(PACKAGE_ROOT, 'lib', 'client.js')))
  assert.ok(existsSync(join(PACKAGE_ROOT, 'lib', 'client.js.map')))
})

test('package.json 无 types / files / devDependencies / scripts 字段', () => {
  assert.equal(packageJson.types, undefined)
  assert.equal(packageJson.files, undefined)
  assert.equal(packageJson.devDependencies, undefined)
  assert.equal(packageJson.scripts, undefined)
  assert.equal(packageJson.dependencies, undefined)
})

test('dsh.client 声明 platform=web 且注入四个客户端包行', () => {
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.deepEqual(packageJson.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-chat',
  ])
})

test('dsh.bundle 指向 cordis.patch.yml 且默认列出', () => {
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh.bundle.listedByDefault, true)
  assert.equal(packageJson.engines.dsh, '>=0.2.2-rc.1 <0.3.0')
})

test('cordis.patch.yml 存在且能解析出 insert 行', () => {
  const patchPath = join(PACKAGE_ROOT, 'cordis.patch.yml')
  assert.ok(existsSync(patchPath))
  const patch = parsePatch(readFileSync(patchPath, 'utf8'))
  assert.equal(patch.insert.length, 1)
  assert.equal(patch.insert[0].name, packageJson.name)
})

test('cordis.patch.yml 的行 id 保持 "turn-summary"（沿用上游行身份）', () => {
  const patch = parsePatch(readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8'))
  assert.equal(patch.insert[0].id, 'turn-summary')
})

test('locale/ 下八个语言 JSON 都能解析且含 meta', () => {
  const files = readdirSync(join(PACKAGE_ROOT, 'locale')).filter((name) => name.endsWith('.json')).sort()
  assert.deepEqual(files, [
    'de.json', 'en.json', 'es.json', 'fr.json', 'ja.json', 'pt.json', 'ru.json', 'zh.json',
  ])
  for (const name of files) {
    const parsed = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'locale', name), 'utf8'))
    assert.ok(parsed.meta, `${name} 缺少 meta`)
    assert.equal(typeof parsed.meta.title, 'string')
    assert.equal(typeof parsed.meta.description, 'string')
  }
})

test('locale/ 是插件市场的展示元数据：每份恰有 title 与 description，title 为该语言的插件名', () => {
  const titles = {
    de: 'Durchlaufzusammenfassung',
    en: 'Turn summary',
    es: 'Resumen del turno',
    fr: 'Résumé du tour',
    ja: 'ターンサマリー',
    pt: 'Resumo da rodada',
    ru: 'Сводка раунда',
    zh: '本轮摘要',
  }
  for (const [language, title] of Object.entries(titles)) {
    const parsed = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'locale', `${language}.json`), 'utf8'),
    )
    assert.deepEqual(Object.keys(parsed.meta), ['title', 'description'], `${language}.json 的 meta 字段集不一致`)
    assert.equal(parsed.meta.title, title, `${language}.json 的插件名不对`)
    assert.ok(parsed.meta.description.length > 0, `${language}.json 的描述不得为空`)
  }
})

test('lib/client.js 不含上游仓库名与本地绝对路径', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(!text.includes('deepseek-harness'))
  assert.ok(!text.includes('C:\\'))
  assert.ok(!/[A-Za-z]:[\\/]/.test(text))
})

test('lib/client.js.map 的 sources 指向 ../src/client/* 且每个目标都存在', () => {
  const map = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js.map'), 'utf8'))
  assert.equal(map.sources.length, 5)
  assert.equal(map.sourcesContent.length, 5)
  assert.deepEqual(map.sources, [
    '../src/client/TurnSummaryLine.tsx',
    '../src/client/locales.ts',
    '../src/client/summary-fold.ts',
    '../src/client/turn-summary-definition.ts',
    '../src/client/index.ts',
  ])
  for (const source of map.sources) {
    assert.ok(existsSync(join(PACKAGE_ROOT, 'lib', source)), `${source} 不存在`)
  }
})

test('漂移守卫：sourcesContent 与 src/client/* 逐字节一致', () => {
  const map = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js.map'), 'utf8'))
  map.sources.forEach((source, index) => {
    const onDisk = readFileSync(join(PACKAGE_ROOT, 'lib', source))
    assert.deepEqual(onDisk, Buffer.from(map.sourcesContent[index], 'utf8'), `${source} 与产物漂移`)
  })
})

test('lib/client.js.map 自身不含绝对路径', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js.map'), 'utf8')
  assert.ok(!text.includes('deepseek-harness'))
  assert.ok(!text.includes('C:\\'))
  assert.ok(!text.includes('C:/'))
  assert.ok(!text.includes('packages/client/ui-turn-summary'))
})

test('src/ 快照齐全（上游 TypeScript 源码快照，本仓库不含构建链）', () => {
  const expected = [
    'src/index.ts',
    'src/css-modules.d.ts',
    'src/client/index.ts',
    'src/client/locales.ts',
    'src/client/summary-fold.ts',
    'src/client/turn-summary-definition.ts',
    'src/client/types.ts',
    'src/client/TurnSummaryLine.tsx',
    'src/client/TurnSummaryLine.module.css',
  ]
  for (const relative of expected) {
    assert.ok(existsSync(join(PACKAGE_ROOT, relative)), `${relative} 缺失`)
  }
})

test('lib/index.js 是 host 半部：只导出空 apply', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'lib', 'index.js'), 'utf8')
  assert.match(text, /function apply\(\) \{\}/)
  assert.match(text, /export \{ apply \};/)
})

test('产物里 pluginNames 由 pluginNamesOf() 求出，不是硬编码的空数组', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')
  const toTurnSummaryAt = text.indexOf('function toTurnSummary(')
  assert.ok(toTurnSummaryAt >= 0, '产物里找不到 toTurnSummary')
  const assignAt = text.indexOf('pluginNames:', toTurnSummaryAt)
  assert.ok(assignAt >= 0, 'toTurnSummary 里找不到 pluginNames 赋值')
  const value = text.slice(assignAt + 'pluginNames:'.length).split('\n')[0].trim().replace(/,$/, '')
  assert.equal(value, 'pluginNamesOf(state, owners)')
  assert.ok(text.includes('function pluginNamesOf(state, owners)'), '产物里找不到 pluginNamesOf 的定义')
})

test('产物里没有 foldTurnSummaryWindow：上游 tree-shaking 已把它剔出运行路径', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(!text.includes('foldTurnSummaryWindow'))
})

test('源码快照仍保留 foldTurnSummaryWindow：src/ 是上游完整源码的镜像，不是用到的代码清单', () => {
  const source = readFileSync(join(PACKAGE_ROOT, 'src', 'client', 'summary-fold.ts'), 'utf8')
  assert.ok(source.includes('export function foldTurnSummaryWindow('))
  const map = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js.map'), 'utf8'))
  assert.ok(map.sourcesContent.join('\n').includes('foldTurnSummaryWindow'))
})
