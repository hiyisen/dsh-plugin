/**
 * Contract tests for the central market index.
 * The index may point at more than one repository; only local paths are
 * checked locally. Remote reachability is covered by scripts/verify-market.mjs.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const REPO_ROOT = process.cwd()
const INDEX = JSON.parse(readFileSync(join(REPO_ROOT, 'market', 'index.json'), 'utf8'))
const entryOf = (name) => INDEX.plugins.find((plugin) => plugin.name === name)

test('索引里同时存在两个插件条目', () => {
  assert.deepEqual(INDEX.plugins.map((plugin) => plugin.name), [
    'dsh-downloader',
    'dsh-turn-summary',
  ])
})

test('分类保持 media，并登记 observability', () => {
  assert.deepEqual(INDEX.metadata.categories.media, {
    title: { en: 'Media & download', 'zh-cn': '媒体与下载' },
  })
  assert.equal(INDEX.metadata.categories.observability.title['zh-cn'], '可观测性')
})

test('dsh-downloader 仍是合集仓库子目录插件', () => {
  const entry = entryOf('dsh-downloader')
  assert.equal(entry.repository.url, 'https://github.com/hiyisen/dsh-plugin')
  assert.equal(entry.repository.directory, 'dsh-downloader')
  assert.equal(entry.versions[0].source.path, 'dsh-downloader')
  assert.equal(entry.versions[0].source.commit, '4bfba8e2d1a91cc6297ebf230941f3bb77dba6a8')
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'dsh-downloader', 'package.json'), 'utf8'))
  assert.equal(packageJson.name, entry.name)
  assert.equal(packageJson.version, entry.versions[0].version)
})

test('dsh-turn-summary 指向独立仓库根目录', () => {
  const entry = entryOf('dsh-turn-summary')
  const version = entry.versions[0]
  assert.equal(entry.repository.url, 'https://github.com/hiyisen/dsh-turn-summary')
  assert.equal(entry.repository.directory, undefined)
  assert.equal(version.source.type, 'git')
  assert.equal(version.source.url, 'https://github.com/hiyisen/dsh-turn-summary')
  assert.equal(version.source.path, undefined)
  assert.match(version.source.commit, /^[0-9a-f]{40}$/)
  assert.equal(version.version, '1.0.0')
  assert.equal(existsSync(join(REPO_ROOT, 'dsh-turn-summary')), false)
})
