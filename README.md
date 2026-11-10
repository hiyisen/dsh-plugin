# dsh-plugin

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件合集。

## dsh-downloader — 资源下载

DSH 左栏「资源下载」面板：粘贴链接即下，进度/速度/预览/打开所在文件夹一站式。

| 平台 | 引擎 | 说明 |
|---|---|---|
| 小红书 图文/视频笔记 | 自带脚本 `xhs_note.py` | 图片优先取**无水印原图**（ci.xiaohongshu.com 原尺寸） |
| 抖音 图文/视频 | 浏览器桥接 `dy_bridge.js` | 借 DSH 内置浏览器页内签名取流（yt-dlp 已被抖音反爬，不可用） |
| HLS/m3u8 | N_m3u8DL-RE | 分片流媒体 |
| 其它（B站/TikTok/微博…） | yt-dlp | 全平台兜底 |

### 安装（macOS / Linux）

```bash
# 1. 依赖
brew install yt-dlp ffmpeg python3        # 或各自平台的等价安装
# N_m3u8DL-RE: https://github.com/nilaoda/N_m3u8DL-RE/releases （HLS 才需要）

# 2. 放进 DSH profile 并注册
cp -r dsh-downloader ~/.dsh/profiles/desktop/
# profile/package.json 加: dependencies "dsh-downloader":"link:./dsh-downloader"
#                         dsh.profile.bundles 加 "dsh-downloader"
ln -sfn ../dsh-downloader ~/.dsh/profiles/desktop/node_modules/dsh-downloader

# 3. 重启 DSH，左栏出现「资源下载」
```

数据目录 `~/.dsh/dl-manager/`（`config.json` 可配 `binPath`/`downloadDir` 等）。

### 开发

- `docs/` 下有原理与业务流程文档（架构 / HTTP API / 流程图）
- `CHANGELOG.md` + git tag 管理版本
- 热调试：`engine.js` / `public/index.html` / `scripts/*` 改完即生效（免重启）

## dsh-turn-summary — 本轮摘要

每轮回复末尾固定一行摘要：本轮用了哪些 skill、各工具调用了几次。

```
本轮 · skill: dsh-client-ui-ux ｜ 工具: read×2, grep×1
本轮 · skill: 无 ｜ 工具: 无
```

折叠全部发生在浏览器里：用客户端**已经收到**的 `tool/call` 事件算出，不请求模型、不消耗 token、不写会话日志；没有就明确写「无」。

![本轮摘要行](docs/dsh-turn-summary-line.png)

| 平台 | 引擎 | 说明 |
|---|---|---|
| 任意 DSH 客户端 | 浏览器端折叠 | 一行固定摘要，挂在可折叠工具组之外，永远可见 |

### 安装（推荐：自建插件市场）

1. DSH 设置 → 插件市场，添加索引地址：
   `https://cdn.jsdelivr.net/gh/hiyisen/dsh-plugin@main/market/index.json`
2. 在市场里找到「本轮摘要」→ 安装
3. 重启 DSH；此后每轮回复下方出现该行

### 安装（手动）

```bash
cp -r dsh-turn-summary ~/.dsh/profiles/desktop/
# profile/package.json 加: dependencies "dsh-turn-summary":"link:./dsh-turn-summary"
#                         dsh.profile.bundles 加 "dsh-turn-summary"
ln -sfn ../dsh-turn-summary ~/.dsh/profiles/desktop/node_modules/dsh-turn-summary
```

### 零 token

数据只来自客户端**已经收到**的 `tool/call` / `turn/start` 事件：浏览器本地折叠 → 本地渲染。不请求模型、不写提示词段、不注册工具、不写会话日志、不发任何网络请求。

### 已知限制

- **「插件」段整段不显示**：客户端拿不到「工具 → 所属插件」的归属映射，宁可留空也不谎报「无」。
- **工具一多会被省略号截断**：这一行是单行样式，超宽以 `…` 截断（完整数据仍在会话事件里）。
- **只在回复结束后出现**：折叠的是已完成的一轮。
- **只统计顶层 `tool/call`**：嵌套流程内部的工具调用不在顶层事件里。

### 开发

- 原理与业务流程（唯一权威）：`docs/dsh-turn-summary 原理与业务流程.md`
- 回归测试（零依赖，无需安装）：`node --test "dsh-turn-summary/tests/*.test.mjs"`（从仓库根；Node ≥ 22 也可直接 `node --test`）——注意 Node ≥ 22 的 `--test` 把位置参数当 glob 模式处理、不再递归目录，所以不要写成 `node --test dsh-turn-summary/tests/`
- 产物入库约定：`src/` 是上游 TypeScript 源码快照、本仓库不含构建链；改逻辑要回上游改 TS → 重建 → 搬运 `lib/` → 提交，`lib/client.js` 与 `lib/client.js.map` 随仓库入库
- 上游出处：`deepseek-ai/deepseek-harness` 的 `packages/client/ui-turn-summary`，提交号 `2094ced757` / `4cd87dc33c`

## License

MIT
