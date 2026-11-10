# 更新日志

用 git 管理版本：每版一个 annotated tag（`v*`），提交说明写清动机。回滚：`git checkout <tag> -- dsh-downloader`。

## dsh-turn-summary v1.0.0 — 2026-11-10
- feat：插件入合集仓库。自建插件市场新增「本轮摘要」条目（分类：可观测性），安装后每轮回复末尾固定显示一行「本轮 · skill: … ｜ 工具: …」
- 原理文档与回归测试随插件入库（docs/dsh-turn-summary 原理与业务流程.md、dsh-turn-summary/tests/，零依赖 node --test）

## v0.3.3 — 2026-11-04
- feat(douyin)：**抖音下载通道上线**。yt-dlp 已被抖音反爬（detail 接口要求浏览器内 JS 签名 a_bogus/UIFID），新增 `scripts/dy_bridge.js`：借 DSH 内置浏览器（ego）在页内 fetch 签名接口拿 CDN 直链，再 curl 直连下载。图文帖（图片+背景音乐）与视频帖均实测可下；目录按真实标题命名，产物含 meta.json/来源.txt
- feat(engine)：`guessKind` 新增 douyin 类型；进度解析复用 yt-dlp 格式；完成校验允许图片/音频媒体；桥接失败给出「打开内置浏览器登录抖音」指路文案
- feat(ui)：任务卡支持「抖音」徽标

## v0.3.2 — 2026-11-04
- feat(xhs)：图片优先下载**无水印原图**（`ci.xiaohongshu.com/<fileId>`，实测 5120×2880 / 张 2~5MB，与浏览器"另存为"同源）；原图失败自动回退 H5 展示图；按魔数纠正扩展名
- fix(engine)：抖音链接失败时给出准确原因（抖音 Web 端要求浏览器 JS 签名，yt-dlp 稳定版/nightly 均无法取流），标记不可重试，不再自动重试空转

## v0.3.1 — 2026-11-04
- fix(xhs)：`dl()` 无代理时 `build_opener(None)` 必抛 TypeError，导致小红书媒体 0 落盘却显示「已完成」——修复并让自检未通过时 `exit 2`，任务如实标红（实测 12 图全部落盘）
- feat(engine)：`POST /api/reveal` 在系统文件管理器中打开所在文件夹（macOS `open`/`open -R`、Windows `explorer /select,`、Linux `xdg-open`），路径限 `downloadDir` 内
- feat(ui)：目录链接与文件行接入 reveal（此前目录指向 api/file 恒 404）；全站去 emoji，换内联 SVG 图标（link/folder/warn/download/check/external，16px stroke currentColor，零外部依赖）

## v0.3.0 — 2026-11-04（本地 fork）
- 项目改名 `dsh-dl-manager` → `dsh-downloader`（目录/包名/插件 id/路由 `/dsh-downloader/*` 全量同步；数据目录 `~/.dsh/dl-manager` 不变，零迁移）
- UI 对齐 DSH 设计体系：接入 `--dsw-*` token（主题桥，随宿主明暗主题联动），配色/圆角/控件形态与 DSH 统一
- 面板显示名改为「资源下载」（左栏入口 + 面板标题）
- 面板独立打开（脱离 iframe）时自动直连 API，方便浏览器 F12 调样式
- 部署改为软链：`~/.dsh/profiles/desktop/dsh-downloader` → 本仓库（开发即部署，改完即生效）

## v0.2.0（上游原始版本 + 本机适配）
- 上游 dsh-dl-manager v0.2.0（MIT）源码引入
- macOS 适配：engine.js 数据目录由 `/data/.dsh/dl-manager` 改为 `~/.dsh/dl-manager`
