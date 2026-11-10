/**
 * 市场索引契约：market/index.json 里的条目必须与仓库里的插件目录对得上。
 *
 * 这一层不需要网络，锁住的是「索引写的」与「仓库里放的」之间的对应关系：
 * 条目名、分类、版本、安装源路径，以及既有插件条目不被改动。
 *
 * 安装源 commit 在远端是否真的可达，由仓库级门禁 scripts/verify-market.mjs
 * 负责（那一步需要网络，不放在这里）。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/** Repository root — this package lives at <repo>/dsh-turn-summary. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The published market index. */
const INDEX = JSON.parse(readFileSync(join(REPO_ROOT, 'market', 'index.json'), 'utf8'))

/** Find one plugin entry by name. */
const entryOf = (name) => INDEX.plugins.find((plugin) => plugin.name === name)

test('索引里同时存在 dsh-downloader 与 dsh-turn-summary 两个条目', () => {
  assert.deepEqual(INDEX.plugins.map((plugin) => plugin.name), [
    'dsh-downloader',
    'dsh-turn-summary',
  ])
})

test('observability 分类已登记，中文标题为「可观测性」', () => {
  const categories = INDEX.metadata.categories
  assert.ok(categories.observability, '缺少 observability 分类')
  assert.equal(categories.observability.title['zh-cn'], '可观测性')
  assert.ok(categories.observability.title.en, 'observability 分类缺少英文标题')
})

test('既有 media 分类未被改动', () => {
  assert.deepEqual(INDEX.metadata.categories.media, {
    title: { en: 'Media & download', 'zh-cn': '媒体与下载' },
  })
})

test('dsh-turn-summary 条目的标题与分类正确', () => {
  const entry = entryOf('dsh-turn-summary')
  assert.equal(entry.title['zh-cn'], '本轮摘要')
  assert.equal(entry.metadata.category, 'observability')
  assert.equal(entry.author, 'hiyisen')
  assert.equal(entry.repository.directory, 'dsh-turn-summary')
})

test('dsh-turn-summary 的中英文描述都存在且描述是中文/英文', () => {
  const { description } = entryOf('dsh-turn-summary')
  assert.ok(description['zh-cn'], '缺少中文描述')
  assert.ok(description.en, '缺少英文描述')
  assert.match(description['zh-cn'], /[一-鿿]/, 'zh-cn 描述必须含中文')
})

test('dsh-turn-summary 的版本是 1.0.0', () => {
  const entry = entryOf('dsh-turn-summary')
  assert.deepEqual(entry.versions.map((version) => version.version), ['1.0.0'])
})

test('安装源是 git 类型，路径指向仓库内的插件目录', () => {
  const source = entryOf('dsh-turn-summary').versions[0].source
  assert.equal(source.type, 'git')
  assert.equal(source.url, 'https://github.com/hiyisen/dsh-plugin')
  assert.equal(source.path, 'dsh-turn-summary')
  assert.match(source.commit, /^[0-9a-f]{40}$/, 'commit 必须是 40 位十六进制')
})

test('索引里的安装源路径在仓库中真实存在，且包名与版本与索引一致', () => {
  for (const plugin of INDEX.plugins) {
    const version = plugin.versions[0]
    const directory = join(REPO_ROOT, version.source.path ?? '')
    assert.ok(existsSync(directory), `${version.source.path} 目录不存在`)
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    assert.equal(pkg.name, plugin.name, `${plugin.name} 的包名与索引不一致`)
    assert.equal(pkg.version, version.version, `${plugin.name} 的版本与索引不一致`)
  }
})

test('既有 dsh-downloader 条目的关键字段未被改动', () => {
  const entry = entryOf('dsh-downloader')
  assert.equal(entry.title['zh-cn'], '资源下载')
  assert.equal(entry.metadata.category, 'media')
  assert.equal(entry.repository.directory, 'dsh-downloader')
  assert.deepEqual(entry.versions.map((version) => version.version), ['0.3.3'])
  assert.equal(
    entry.versions[0].source.commit,
    '4bfba8e2d1a91cc6297ebf230941f3bb77dba6a8',
    'dsh-downloader 的安装源 commit 被改动了',
  )
})
