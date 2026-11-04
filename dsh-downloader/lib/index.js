/**
 * dsh-downloader —— 左栏「下载管理器」面板的 host 侧（极简壳）。
 *
 * 设计要点：本文件只负责「注册路由 + 按需热加载引擎」，真正干活的逻辑在
 * /data/.dsh/dl-manager/engine.js。这样以后改下载引擎**不需要重启网关**——
 * 只要改 engine.js，下一次请求会自动重新加载（按文件 mtime 判断）。
 *
 * 路由（前缀，DSH 同源，客户端 iframe 直接 fetch，不走 apiProxy）：
 *   /dsh-downloader                → 面板界面
 *   /dsh-downloader/api/...        → 任务引擎（见 engine.js）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-downloader';
export const inject = ['webServer'];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');
const SCRIPTS = path.resolve(HERE, '..', 'scripts');
// 引擎与插件同目录（lib/engine.js）——这样整个插件自包含，可整包导出给别的 DSH 安装。
// 仍按 mtime 热加载：改 engine.js 后下一次请求自动重载，无需重启网关。
const ENGINE = path.join(HERE, 'engine.js');
let engine = null;
let engineMtime = -1;

async function loadEngine() {
  try {
    const st = fs.statSync(ENGINE);
    if (!engine || st.mtimeMs > engineMtime) {
      const mod = await import(ENGINE + '?t=' + st.mtimeMs);
      engine = mod;
      engineMtime = st.mtimeMs;
      if (engine.setAssets) engine.setAssets(PUBLIC);
      if (engine.setScriptsDir) engine.setScriptsDir(SCRIPTS);
      console.info('[dsh-downloader] engine 已加载/热更新 (mtime=' + st.mtimeMs + ')');
    }
  } catch (e) {
    console.error('[dsh-downloader] engine 加载失败:', (e && e.message) || e);
  }
  return engine;
}

export function apply(ctx) {
  const webServer = ctx.webServer;
  ctx.effect(() => {
    const disposers = [];
    loadEngine();
    disposers.push(webServer.register({ kind: 'prefix', path: '/dsh-downloader', handler: async (req, res) => {
      const eng = await loadEngine();
      if (!eng || !eng.handler) { res.writeHead(500); res.end('engine 不可用'); return; }
      return eng.handler(req, res);
    }}));
    console.info('[dsh-downloader] 已挂载 /dsh-downloader (lazy engine)');
    return () => { for (const d of disposers) { try { d(); } catch {} } };
  });
}
