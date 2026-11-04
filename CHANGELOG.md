# 更新日志

用 git 管理版本：每版一个 annotated tag（`v*`），提交说明写清动机。回滚：`git checkout <tag> -- dsh-downloader`。

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
