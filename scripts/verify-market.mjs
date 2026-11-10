#!/usr/bin/env node
/**
 * 市场索引发布门禁：逐条验证 market/index.json 里的安装源**真的能装上**。
 *
 * 背景：索引里的 source.commit 必须是一个在远端**可达**的 commit。如果发布时
 * 提交历史被重写（例如换了发布通道重新提交），本地算出的 hash 在远端并不存在，
 * 市场安装就会在 `git checkout <commit>` 这一步直接失败 —— 而索引本身看起来
 * 完全正常，肉眼很难发现。本脚本把这一步变成可自动执行的检查。
 *
 * 校验项（每个 git 类型的版本各做一遍）：
 *   1. source.commit 在 source.url 指向的远端可达
 *   2. source.path 指定的目录在该 commit 处存在
 *   3. 该目录里的 package.json 存在，且 name 与索引条目一致
 *   4. 该 package.json 的 version 与索引里的版本一致
 *
 * 用法: node scripts/verify-market.mjs            （校验索引里的全部条目）
 *       node scripts/verify-market.mjs <插件名>   （只校验指定插件）
 *
 * 零依赖：只用 node 内置模块与 git 命令行。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ONLY = process.argv[2] ?? ''
const ROOT = process.cwd()
const INDEX = join(ROOT, 'market', 'index.json')

/**
 * Run a git command in a directory and return its trimmed stdout.
 * @param {string} cwd - Working directory.
 * @param {string[]} args - Git arguments.
 * @returns {string} stdout.
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }).trim()
}

const index = JSON.parse(readFileSync(INDEX, 'utf8'))
const entries = []
for (const plugin of index.plugins) {
  for (const version of plugin.versions) {
    if (version.source?.type !== 'git') continue
    entries.push({ name: plugin.name, ...version })
  }
}

const targets = ONLY ? entries.filter((e) => e.name === ONLY) : entries
if (targets.length === 0) {
  console.error(`索引里没有可校验的 git 类型条目${ONLY ? `（插件名 ${ONLY}）` : ''}`)
  process.exit(1)
}

let failed = 0

for (const entry of targets) {
  const { name, version, source } = entry
  const repo = source.url.endsWith('.git') ? source.url : `${source.url}.git`
  const short = source.commit.slice(0, 12)
  const work = mkdtempSync(join(tmpdir(), 'verify-market-'))

  try {
    git(work, ['init', '--quiet'])
    git(work, ['remote', 'add', 'origin', repo])

    let reachable = true
    try {
      git(work, ['fetch', '--quiet', '--depth=1', 'origin', source.commit])
    } catch {
      reachable = false
    }

    if (!reachable) {
      console.log(`✗ ${name} v${version} —— commit ${short} 在 ${repo} 不可达`)
      console.log('    市场安装会在 git checkout 这一步失败。请把 source.commit 改成远端真实存在的 commit。')
      failed++
      continue
    }

    git(work, ['checkout', '--quiet', 'FETCH_HEAD'])

    const pkgPath = join(work, source.path ?? '', 'package.json')
    if (!existsSync(pkgPath)) {
      console.log(`✗ ${name} v${version} —— commit 可达，但路径 '${source.path ?? ''}' 下没有 package.json`)
      failed++
      continue
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg.name !== name) {
      console.log(`✗ ${name} v${version} —— 目录里的包名是 '${pkg.name}'，与索引条目不一致`)
      failed++
      continue
    }
    if (pkg.version !== version) {
      console.log(`✗ ${name} v${version} —— 目录里的版本是 '${pkg.version}'，与索引不一致`)
      failed++
      continue
    }

    console.log(`✓ ${name} v${version} —— commit ${short} 可达，路径 '${source.path ?? ''}' 下包名与版本均一致`)
  } catch (error) {
    console.log(`✗ ${name} v${version} —— 校验过程出错：${error.message.split('\n')[0]}`)
    failed++
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

console.log('')
if (failed > 0) {
  console.log(`市场索引校验失败：${targets.length} 条中 ${failed} 条不可安装。`)
  process.exit(1)
}
console.log(`市场索引校验通过：${targets.length} 条全部可安装。`)
