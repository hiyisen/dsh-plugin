# dsh-turn-summary 行为规格

> **唯一权威规格。** 本插件的线上行为以此文为准；`lib/client.js` 是它的实现，`dsh-turn-summary/tests/` 是它的可执行副本。
> 实现出处：`dsh-turn-summary/src/client/`（上游 `deepseek-ai/deepseek-harness` 的 `packages/client/ui-turn-summary` 逐字节快照）。

---

## 1. 常量（8 项）

| 常量 | 值 | 含义 |
|---|---|---|
| `SKILL_TOOL_NAME` | `"skill"` | 线上协议里 skill 加载的工具名 |
| `TURN_SUMMARY_DATA_KEY` | `"turn-summary"` | Conversation Location 数据键（`turn.data.get('turn-summary')`） |
| `TURN_SUMMARY_DEFINITION_KIND` | `"turn-summary"` | Conversation Definition 的 kind |
| `TURN_SUMMARY_ENTRY_ID`（内部名 `TURN_TAIL_ROW_KEY`） | `"dsh-turn-summary"` | `conversation.chat.turnTail` 槽位条目 id |
| `MAX_SKILL_ARGUMENT_CHARS` | `4096` | 单次 `skill` 参数 JSON 的长度上限（按 **UTF-16 code unit** 计） |
| `MAX_NAME_CHARS` | `120` | 单个保留名的长度上限（按 **Unicode 码点** 计，`Array.from(...).slice(...)`） |
| `MAX_SKILL_NAMES` | `16` | 单轮保留的不同 skill 名数量上限 |
| `NS`（字典命名空间） | `"turnSummary"` | `ctx.locale.register` 的命名空间 |

---

## 2. `skillNameOf(argumentsText) → string | undefined`

按顺序判定，命中任一条即返回 `undefined`（该次 `skill` 调用被记为「未识别」）：

| # | 判定 | 结果 |
|---|---|---|
| 1 | `argumentsText.length > 4096` | `undefined`（整条调用不可读） |
| 2 | `JSON.parse` 抛错 | `undefined` |
| 3 | 解析结果不是 object / 是 `null` / 是数组 | `undefined` |
| 4 | 没有 `name` 键 | `undefined` |
| 5 | `name` 不是字符串 | `undefined` |
| 6 | `name.trim()` 后为空 | `undefined` |
| 7 | 以上都不命中 | `Array.from(name.trim()).slice(0, 120).join('')`（按码点截断） |

> 长度上限是 **4096 个 UTF-16 code unit**，名字上限是 **120 个码点**——两者单位不同，别混。

---

## 3. `foldTurnSummaryEvent(state, event) → state'`

纯函数；下表中「状态不变」一律指**返回同一引用**（`state' === state`）。

### 3.1 五条状态不变的情形

| # | 条件 | 行为 |
|---|---|---|
| 1 | `event.type === 'ignored'` | 状态不变（不计 skill、不计工具） |
| 2 | `event.type === 'turn/end'` | 状态不变（轮次结束本身不产生事实） |
| 3 | `event.turn !== state.turn` | 状态不变（别轮次的事件） |
| 4 | `event.seq < state.startSeq` | 状态不变（fork 继承的历史） |
| 5 | `boundedName(event.name)` 为空（工具名 trim 后无可见文字） | 状态不变 |

### 3.2 一条重置规则

| 条件 | 行为 |
|---|---|
| `event.type === 'turn/start'` | **重置**为 `emptyTurnSummaryState(event.turn, event.seq)`；fork 继承的历史因此不会污染新一轮 |

### 3.3 两条计数规则

| 条件 | 行为 |
|---|---|
| 工具名 === `"skill"` | `skillCallCount += 1`（**总是**加）。名字解析失败（`skillNameOf` 返回 `undefined`）时 `unreadableSkillCalls += 1` 且不记名；解析成功时**仅当**「该名字尚未出现过」**且**「当前不同名数量 < 16」才追加到 `skillNames`——超过 16 个上限后仍计数但不再记名 |
| 其它工具名 | `toolCounts` 按名累加，**保留首次使用顺序**（新名追加到末尾，同名计数 +1） |

### 3.4 `emptyTurnSummaryState(turn, startSeq)`

```
{ turn, startSeq, skillCallCount: 0, skillNames: [], unreadableSkillCalls: 0, toolCounts: [] }
```

---

## 4. `toTurnSummary(state, owners = NO_TOOL_OWNERS)`

| 字段 | 内容 |
|---|---|
| `turn` | 轮次号 |
| `skillCallCount` | `skill` 调用次数（含不可读的那些） |
| `skillNames` | 不同 skill 名，按首次加载顺序 |
| `unreadableSkillCalls` | 名字解析失败的 `skill` 调用数 |
| `pluginNames` | 由 `owners.ownersOf(toolName)` 逐工具解析，去重、保留首次归属顺序、按 120 码点截断 |
| `toolCounts` | 非 skill 工具的调用计数，按首次使用顺序 |

**当前实现的 `pluginNames` 恒为空**：`NO_TOOL_OWNERS.ownersOf()` 恒返回 `[]`（客户端没有「工具 → 所属插件」的映射表）。这是**有意的诚实缺省**——写「无」等于谎报「本轮没有插件」，所以界面上**整段不出现**。

---

## 5. `sameTurnSummary(left, right)`

逐字段比较，全部相等才为 `true`：

| 字段 | 比较方式 |
|---|---|
| `turn` | `===` |
| `skillCallCount` | `===` |
| `unreadableSkillCalls` | `===` |
| `skillNames` | 长度相等且**逐位同序**相等 |
| `pluginNames` | 长度相等且**逐位同序**相等 |
| `toolCounts` | 长度相等，且每项的 `name` 与 `count` 按序相等 |

用途：`buildLocationData` 在事实未变时**复用旧值**（保持对象身份，避免无谓重渲染）。

---

## 6. `foldTurnSummaryWindow(events, { fromSeq = 0, owners })`

回放一段事件窗口的公开工具（插件运行时未使用）。

| # | 规则 | 行为 |
|---|---|---|
| 1 | `event.seq < fromSeq` | 跳过（继承历史，永不贡献） |
| 2 | 窗口内**首个**有效事件不是 `turn/start` | 用 `emptyTurnSummaryState(event.turn, fromSeq)` 派生状态（分页历史页也能给出诚实的行） |
| 3 | 窗口内出现 `turn/start` | 从它开始新状态（重置） |
| 4 | 空窗口 | `emptyTurnSummaryState(0, fromSeq)` |
| 5 | 返回 | `toTurnSummary(state, owners)` |

---

## 7. Conversation Definition 契约

`toTurnSummaryEvent(event)` 的适配映射：

| 原事件 | 适配后 |
|---|---|
| `turn/start` | `{type:'turn/start', seq, turn: event.data.turn}` |
| `turn/end` | `{type:'turn/end', seq, turn: event.data.turn}` |
| `tool/call` | `{type:'tool/call', seq, turn: event.data.turn, name: event.data.name, arguments: event.data.arguments}` |
| 其它 | `{type:'ignored', seq}` |

`createTurnSummaryDefinition(owners)` 返回的对象：

| 成员 | 规格 |
|---|---|
| `kind` | `"turn-summary"` |
| `match(event)` | `turn/start` → `{id: String(event.data.turn), role: 'start'}`；`tool/call` / `turn/end` → `{id: String(event.data.turn), role: 'update'}`；其它 → `null` |
| `start(_, match)` | `match.event` 必须是 `turn/start`，否则抛 `turn-summary start requires turn/start`；返回 `emptyTurnSummaryState(turn, seq)` |
| `update(context, match)` | `foldTurnSummaryEvent(context.state, toTurnSummaryEvent(match.event))` |
| `buildLocationData(context, scope, previous)` | `scope !== 'turn'` 或 `context.state === undefined` → `null`；否则 `value = toTurnSummary(state, owners)`；若 `previous` 满足 `{kind:'turn', key:'turn-summary', turn === value.turn}` 且 `sameTurnSummary(previous.value, value)` → **返回 `previous` 同一个对象**（保持身份）；否则返回 `{kind:'turn', turn: value.turn, key:'turn-summary', value}` |

---

## 8. 装配三件事

插件侧 `apply(ctx)` 只做三件事，且全部经由 `ctx.effect` / `ctx.slots.inject` 注册：

| # | 动作 | 精确要求 |
|---|---|---|
| 1 | `ctx.locale.register(NS, dict)` | `NS = "turnSummary"`；`dict` 键序 `zh, en, ja, es, fr, de, ru, pt` |
| 2 | `ctx.uiConversation.events.register({...definition, match: {'turn/start': match, 'tool/call': match, 'turn/end': match}})` | 只注册这三类事件的路由；其它事件类型不注册 |
| 3 | `ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({name:'conversation.chat.turnTail', id:'dsh-turn-summary', order:10, locale:'turnSummary'}, TurnSummaryLine))` | `id` 必须是 `dsh-turn-summary`；`order` 为 `10`；`locale` 命名空间为 `turnSummary`（组件据此拿到 `t` prop） |

**host 半部**（`lib/index.js`）：`apply()` 是空实现——本插件是纯浏览器插件，host 侧没有任何逻辑、没有任何网络调用、不会触碰模型。

---

## 9. 渲染规格

`TurnSummaryLine({ turn, t })`：

| 项 | 规格 |
|---|---|
| 取数 | `turn.data.get('turn-summary')`；取不到时用全 0 / 全空的默认值 |
| skill 段 | `skillCallCount === 0` → `t('none')`；否则取 `skillNames`，当 `unreadableSkillCalls > 0` 时把 `t('unreadable')` **追加到末尾**，用 `t('separator')` 连接；结果为空则用 `t('unreadable')` |
| tools 段 | `toolCounts` 为空 → `t('none')`；否则每项 `t('toolCount', {name, count})`，用 `t('separator')` 连接 |
| plugins 段 | `pluginNames` 非空 → `t('line.withPlugins', {skill, plugins, tools})`；否则 → `t('line', {skill, tools})`（**无插件段**） |
| DOM | 单个 `<div>`；**无按钮、无 open state、无命令、无交互** |
| 属性 | `className`（样式类）、`data-turn-summary={turn.turn}`、`data-turn-summary-skill-calls`、`data-turn-summary-tool-calls`（各工具 count 之和） |
| 位置 | `conversation.chat.turnTail`（list seat）——位于可折叠工具组**之外**，所以永远可见 |

---

## 10. 八语言文案表

字典命名空间 `turnSummary`，键集固定 6 个（`zh` 为键集真源）：`line` / `line.withPlugins` / `none` / `unreadable` / `separator` / `toolCount`。

| 键 | zh | en |
|---|---|---|
| `line` | `本轮 · skill: {skill} ｜ 工具: {tools}` | `This turn · skill: {skill} \| tools: {tools}` |
| `line.withPlugins` | `本轮 · skill: {skill} ｜ 插件: {plugins} ｜ 工具: {tools}` | `This turn · skill: {skill} \| plugins: {plugins} \| tools: {tools}` |
| `none` | `无` | `None` |
| `unreadable` | `未知` | `unknown` |
| `separator` | `, ` | `, ` |
| `toolCount` | `{name}×{count}` | `{name}×{count}` |

| 键 | ja | es |
|---|---|---|
| `line` | `本ラウンド · skill: {skill} ｜ ツール: {tools}` | `Esta ronda · skill: {skill} ｜ herramientas: {tools}` |
| `line.withPlugins` | `本ラウンド · skill: {skill} ｜ プラグイン: {plugins} ｜ ツール: {tools}` | `Esta ronda · skill: {skill} ｜ complementos: {plugins} ｜ herramientas: {tools}` |
| `none` | `なし` | `Ninguno` |
| `unreadable` | `不明` | `desconocido` |
| `separator` | `, ` | `, ` |
| `toolCount` | `{name}×{count}` | `{name}×{count}` |

| 键 | fr | de |
|---|---|---|
| `line` | `Ce tour · skill: {skill} ｜ outils: {tools}` | `Dieser Durchlauf · skill: {skill} ｜ Werkzeuge: {tools}` |
| `line.withPlugins` | `Ce tour · skill: {skill} ｜ plugins: {plugins} ｜ outils: {tools}` | `Dieser Durchlauf · skill: {skill} ｜ Plugins: {plugins} ｜ Werkzeuge: {tools}` |
| `none` | `Aucun` | `Keine` |
| `unreadable` | `inconnu` | `unbekannt` |
| `separator` | `, ` | `, ` |
| `toolCount` | `{name}×{count}` | `{name}×{count}` |

| 键 | ru | pt |
|---|---|---|
| `line` | `Этот раунд · skill: {skill} ｜ инструменты: {tools}` | `Esta rodada · skill: {skill} ｜ ferramentas: {tools}` |
| `line.withPlugins` | `Этот раунд · skill: {skill} ｜ плагины: {plugins} ｜ инструменты: {tools}` | `Esta rodada · skill: {skill} ｜ plugins: {plugins} ｜ ferramentas: {tools}` |
| `none` | `Нет` | `Nenhum` |
| `unreadable` | `неизвестно` | `desconhecido` |
| `separator` | `, ` | `, ` |
| `toolCount` | `{name}×{count}` | `{name}×{count}` |

---

## 11. 七条铁律

1. **零 token**：不得引入模型请求、提示词段落、工具注册、会话事件写入或任何网络请求；数据只能来自客户端**已经收到**的 `tool/call` 事件。
2. **always-visible**：行渲染在 `conversation.chat.turnTail`（可折叠工具组**之外**），不得改成可折叠 / 可点击 / 带命令。
3. **显式「无」**：没有 skill、没有工具时**必须**显式写「无」，不省略字段、不留空白。
4. **skill 不重复计数**：`skill` 工具的调用只进 skill 段，不再计入「工具」段。
5. **fork 边界**：新 `turn/start` 重置状态；`seq` 小于本轮 `startSeq` 与其它轮次的事件一律丢弃。
6. **有界**：`skill` 参数超过 4096 字符记为不可读；名字按 120 **码点**截断；每轮最多 16 个不同 skill 名。
7. **诚实缺省**：`pluginNames` 无归属依据时留空，界面上不出现「插件」段——不写「无」。

---

## 12. 黄金输出

以下数值由回归测试从**真正被发布的 `lib/client.js`** 实测得到，可逐字比对。

```
注册 id            = dsh-turn-summary
exports keys       = ['apply', 'inject']
inject             = ["slots","locale","uiConversation"]
CSS <style>        = { plugin:'dsh-turn-summary', css:'dsh-turn-summary/TurnSummaryLine.module.css' }
字典              = ns=turnSummary, keys=[zh,en,ja,es,fr,de,ru,pt]
Definition        = kind='turn-summary', match keys=['turn/start','tool/call','turn/end']
槽位              = {name:'conversation.chat.turnTail', id:'dsh-turn-summary', order:10, locale:'turnSummary'}

match(turn/start) = {"id":"7","role":"start"}
match(tool/call)  = {"id":"7","role":"update"}
match(turn/end)   = {"id":"7","role":"update"}

一轮事件：turn/start(turn=7,seq=100) → skill(dsh-client-ui-ux,seq=101) → read(102) → read(103) → grep(104)

state     = {"turn":7,"startSeq":100,"skillCallCount":1,"skillNames":["dsh-client-ui-ux"],
             "unreadableSkillCalls":0,"toolCounts":[{"name":"read","count":2},{"name":"grep","count":1}]}
published = {"kind":"turn","turn":7,"key":"turn-summary",
             "value":{"turn":7,"skillCallCount":1,"skillNames":["dsh-client-ui-ux"],"unreadableSkillCalls":0,
                      "pluginNames":[],"toolCounts":[{"name":"read","count":2},{"name":"grep","count":1}]}}
rendered  = <div class="vqEcJa_root" data-turn-summary="7" data-turn-summary-skill-calls="1"
                  data-turn-summary-tool-calls="3">本轮 · skill: dsh-client-ui-ux ｜ 工具: read×2, grep×1</div>
```

对应的回归用例：`dsh-turn-summary/tests/turn-summary-behavior.test.mjs`（黄金输出 / 折叠行为 / 边界）与 `dsh-turn-summary/tests/bundle-contract.test.mjs`（产物契约 / 装配三件事）。

---

## 13. 维护约定

- `src/` 是上游 TypeScript 源码的**逐字节快照**，本仓库**不含构建链**：改逻辑要回上游改 TS → 重建 → 搬运 `lib/` → 提交。
- 线上以 `lib/` 为准；语义以本文为准。
- `lib/client.js.map` 内嵌的 `sourcesContent` 必须与 `src/client/*` **逐字节一致**（回归测试里的漂移守卫）；`sources` 已改写为 `../src/client/*`。
