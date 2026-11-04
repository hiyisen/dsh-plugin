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

## License

MIT
