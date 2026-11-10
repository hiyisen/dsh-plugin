# dsh-turn-summary — 本轮摘要

> DeepSeek Harness（DSH）插件：在**每轮回复末尾**固定显示一行摘要——本轮用了哪些 skill、各工具调用了几次。

```
本轮 · skill: dsh-client-ui-ux ｜ 工具: read×2, grep×1
本轮 · skill: 无 ｜ 工具: 无
```

这一行**不可折叠、不可点击、没有命令**：它挂在会话轮的尾部（可折叠工具组之外），所以工具一多、卡片收起来，它照样可见。

## 零 token：数据只来自客户端已经收到的事件

| 维度 | 行为 |
|---|---|
| 模型请求 | **无**。摘要行不请求模型，也不让模型汇报自己的用量 |
| 提示词 | **无**。不写任何提示词段、不注册任何工具 |
| 会话日志 | **无**。不产生新的会话事件、不写会话日志 |
| 数据来源 | 客户端**已经收到**的 `turn/start` / `tool/call` 事件，在浏览器里折叠 |
| 网络 | **无**。折叠与渲染全在本地完成 |

折叠逻辑是纯函数（无 React、无 Cordis、无模型），可以拿录制的会话日志回放复现。

## 显示什么

| 段 | 内容 | 缺省 |
|---|---|---|
| skill | 本轮加载过的 skill 名（去重、按首次加载顺序） | 显式写「无」 |
| 插件 | 本轮工具所属的插件名 | **整段不显示**（客户端拿不到「工具 → 所属插件」映射，宁可留空也不猜） |
| 工具 | 各工具的调用次数（按首次使用顺序） | 显式写「无」 |

`skill` 工具的调用**只**进 skill 段，不会重复计入「工具」段。

## 目录结构

```
dsh-turn-summary/
├── package.json          包元数据（DSH bundle / client 声明）
├── cordis.patch.yml      profile bundle 行：id=turn-summary, name=dsh-turn-summary
├── lib/
│   ├── client.js         浏览器半部产物（真正被加载的那份）
│   ├── client.js.map     浏览器半部 sourcemap（sources 已改写为 ../src/client/*）
│   └── index.js          host 半部（空 apply，仅为让插件出现在 bundle 层）
├── locale/               八种语言的插件名与描述
├── src/                  ★ 产出 lib/ 的上游 TypeScript 源码快照
└── tests/                零依赖回归测试（node --test）
```

### 关于 `src/`：它是快照，不是构建入口

`src/` 是从上游 monorepo（`deepseek-ai/deepseek-harness` 的 `packages/client/ui-turn-summary`）**逐字节拷贝**的 TypeScript 源码快照，**本仓库不含构建链**（没有 tsdown/tsc、没有 node_modules、没有构建脚本）。

因此：

- 要**改逻辑**：回上游改 TypeScript → 重新构建 → 把新的 `lib/client.js` / `lib/client.js.map` 搬运到本仓库 → 提交；
- **线上以 `lib/` 为准**（DSH 加载的是 `lib/client.js`，`src/` 不参与运行）；
- **语义以 [`docs/dsh-turn-summary 行为规格.md`](../../docs/dsh-turn-summary%20行为规格.md) 为准**（唯一权威规格）；
- 回归测试里有一条**漂移守卫**：比对 `lib/client.js.map` 内嵌的 `sourcesContent` 与 `src/client/*` 的磁盘字节——两者必须逐字节一致，否则说明源码与产物漂移了。

## 安装

### 推荐：自建插件市场

1. DSH 设置 → 插件市场，添加索引地址：
   `https://cdn.jsdelivr.net/gh/hiyisen/dsh-plugin@main/market/index.json`
2. 在市场里找到「本轮摘要」→ 安装
3. 重启 DSH；此后每轮回复下方出现该行

### 手动安装

```bash
cp -r dsh-turn-summary ~/.dsh/profiles/desktop/
# profile/package.json 加: dependencies "dsh-turn-summary":"link:./dsh-turn-summary"
#                         dsh.profile.bundles 加 "dsh-turn-summary"
ln -sfn ../dsh-turn-summary ~/.dsh/profiles/desktop/node_modules/dsh-turn-summary
```

## 已知限制

1. **「插件」段整段不显示**：客户端没有「工具 → 所属插件」的归属表。这是有意的诚实缺省——写「无」等于谎报「本轮没有插件」，所以整段不出现。
2. **工具一多会被省略号截断**：这一行是单行 `nowrap` 样式，超宽时以 `…` 截断（完整数据仍在会话事件里）。
3. **只在回复结束后出现**：折叠的是已完成的一轮；进行中的轮次不显示这一行。
4. **只统计顶层 `tool/call`**：子代理/嵌套流程内部的工具调用不在顶层事件里，不计入。

此外：skill 名解析失败（参数 JSON 非法或超过 4096 字符）时显示「未知」；skill 名按**码点**截断到 120 个字符；每轮最多保留 16 个不同的 skill 名（超出后调用计数照加，只是不再记名）。

## 开发

```bash
# 零依赖回归测试（Node ≥ 18，无需 npm install）
node --test "dsh-turn-summary/tests/*.test.mjs"
# 从仓库根直接跑（Node ≥ 22 会递归搜索当前目录）等价于：
node --test
```

测试直接驱动**真正被发布的 `lib/client.js`**（假 `window.__ModuleLoader__` + 最小 React 替身 + 假 client context），不重新实现折叠逻辑，因此能守住产物。

**产物入库约定**：`src/` 改了就必须重新搬运并提交 `lib/`，否则漂移守卫会失败。搬运时对 `lib/client.js` 只允许改两处注释（绝对路径泄漏），其余字节逐字保留。

## 上游出处

- 上游仓库：`deepseek-ai/deepseek-harness`，包路径 `packages/client/ui-turn-summary`
- 引入提交：`2094ced757`（feat(client): 新增 ui-turn-summary 用户态插件）
- 产物同步提交：`4cd87dc33c`（chore: 同步 ui-turn-summary 引入的生成物与工程配置）

## License

MIT
