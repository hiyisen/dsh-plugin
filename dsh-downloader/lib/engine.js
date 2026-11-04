/**
 * dsh-downloader —— 左栏「下载管理器」面板的 host 侧。
 *
 * 做法照 dsh-node-flow：inject webServer，在同一个 web 服务上挂**同源**前缀路由
 * /dsh-downloader/（客户端 iframe 直接 fetch，不走 apiProxy）。
 *
 * 路由：
 *   GET  /dsh-downloader/                 → 面板界面（iframe 内容）
 *   GET  /dsh-downloader/api/tasks       → 任务列表
 *   POST /dsh-downloader/api/tasks       → 新建任务 {url, name?}
 *   GET  /dsh-downloader/api/tasks/:id   → 任务详情（含文件清单）
 *   POST /dsh-downloader/api/tasks/:id/action → {action: delete|deleteFiles|retry|stop}
 *   GET  /dsh-downloader/api/log/:id     → 最近日志（排错用）
 *   GET  /dsh-downloader/api/file?path=  → 读文件（支持 Range，视频可直接播）
 *   POST /dsh-downloader/api/reveal      → 在系统文件管理器中打开 {path}（mac open / win explorer / linux xdg-open）
 *
 * 数据落在 /data/.dsh/dl-manager （docker 卷，重建容器不丢）。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


// PUBLIC（面板 HTML 所在目录）由宿主壳通过 setAssets(dir) 注入，
// 因为引擎文件位置（/data/.dsh/dl-manager/engine.js）与插件目录分离，不能按自身路径推算。
let PUBLIC = '/data/.dsh/profiles/web/node_modules/dsh-downloader/public';
export function setAssets(dir) { PUBLIC = dir; }

// 版本号以 package.json 为准，面板在返回 HTML 时注入（单一来源）
let PLUGIN_VERSION = '0.1.0';
try { PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.resolve(PUBLIC, '..', 'package.json'), 'utf8')).version || PLUGIN_VERSION; } catch {}

const DATA = process.env.DLM_DATA || path.join(os.homedir(), '.dsh', 'dl-manager');
const LOGDIR = path.join(DATA, 'logs');
const STORE = path.join(DATA, 'tasks.json');
const CONCURRENCY = 2;
const MAX_AUTO_RETRY = 3; // CDN 断流 / 网络抖动这类错误自动续传重试次数，超出后交用户手动重试
// 国内站点直连白名单：这些域名不走代理（更快，且 B站/抖音 视频 CDN 经代理会卡死）。外站仍走代理。
const CN_NOPROXY = '.bilibili.com,bilibili.com,.xiaohongshu.com,xiaohongshu.com,xhslink.cn,.douyin.com,douyin.com,v.douyin.com,iesdouyin.com,.iqiyi.com,iqiyi.com,.youku.com,youku.com,.weibo.com,weibo.com,.kuaishou.com,kuaishou.com,.acfun.cn,acfun.cn,.toutiao.com,toutiao.com,.baidu.com,baidu.com';
const PREFIX = '/dsh-downloader';

// 脚本目录（真正的下载逻辑：xhs_note.py / dl_hls.sh 等）由宿主壳通过 setScriptsDir 注入，
// 默认退回到旧技能目录便于平滑过渡；独立打包后指向插件自带的 scripts/。
const _HERE = path.dirname(fileURLToPath(import.meta.url)); // 本文件所在目录 = 插件 lib/
let SCRIPTS = process.env.DLM_SCRIPTS || path.join(_HERE, '..', 'scripts');
export function setScriptsDir(d) { SCRIPTS = d; }

// 配置：下载目录 / 临时目录 / 各下载工具路径均可配（见面板「设置」）。
// 优先级：config.json 文件 > 环境变量 > 内置默认。工具路径支持「裸命令名」（从 PATH 解析）或绝对路径。
function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch {}
  const pick = (key, envName, dflt) =>
    (file[key] != null && file[key] !== '') ? file[key] : (envName && process.env[envName] ? process.env[envName] : dflt);
  const cfg = {
    downloadDir: pick('downloadDir', 'DLM_DOWNLOAD_DIR', path.join(DATA, 'downloads')),
    tempDir:     pick('tempDir', 'DLM_TMP', path.join(DATA, 'tmp_down')),
    python3:     pick('python3', 'PYTHON3', 'python3'),
    ytDlp:       pick('ytDlp', 'YTDLP', 'yt-dlp'),
    ffmpeg:      pick('ffmpeg', 'FFMPEG', 'ffmpeg'),
    ffprobe:     pick('ffprobe', 'FFPROBE', 'ffprobe'),
    re:          pick('re', 'RE_BIN', 'N_m3u8DL-RE'),
    binPath:     pick('binPath', 'DLM_BIN_PATH', ''),
  };
  const resolveTool = (p) => {
    if (!p) return p;
    if (path.isAbsolute(p)) return p;
    try { return execFileSync('which', [p], { encoding: 'utf8', timeout: 4000 }).trim().split('\n')[0] || p; } catch { return p; }
  };
  cfg.python3 = resolveTool(cfg.python3); cfg.ytDlp = resolveTool(cfg.ytDlp);
  cfg.ffmpeg = resolveTool(cfg.ffmpeg); cfg.ffprobe = resolveTool(cfg.ffprobe); cfg.re = resolveTool(cfg.re);
  return cfg;
}
let cfg = loadConfig();

fs.mkdirSync(LOGDIR, { recursive: true });
if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, '{"tasks":[]}');

const db = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const save = () => fs.writeFileSync(STORE, JSON.stringify(db, null, 1));
const now = () => new Date().toISOString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const logPath = (id) => path.join(LOGDIR, id + '.log');

// 从小红书"分享文案"(含中文描述+链接)或任意文本里提取第一个真实链接
function firstUrl(raw) {
  if (!raw) return null;
  const m = String(raw).match(/https?:\/\/\S+/i);
  if (!m) return null;
  // 去掉常见的包裹 / 尾随符号（半角圆括号、方括号、引号、中文【】》）
  return m[0].replace(/[)\]}'"‘’【】]+$/, '');
}
function guessKind(url) {
  const u = firstUrl(url) || String(url || '');
  if (/\.m3u8(\?|$)/i.test(u)) return 'hls';
  if (/xiaohongshu\.com|xhslink\.cn|xiaohongshu\.cn/i.test(u)) return 'xhs';
  return 'yt'; // 全平台兜底：bilibili / 抖音 / douyin / tiktok / 微博 / 快手 … yt-dlp 支持的一大堆
}
// 判断链接是否国内站点（国内直连，不走代理）
function isCnUrl(url) {
  const u = firstUrl(url) || String(url || '');
  return /bilibili\.com|xiaohongshu\.com|xhslink\.cn|douyin\.com|iesdouyin|iqiyi\.com|youku\.com|weibo\.com|kuaishou\.com|acfun\.cn|toutiao\.com|\.cn\b|cn\.com/i.test(u);
}
function deriveName(url) {
  const u = firstUrl(url) || url;
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean).pop();
    return String(seg || 'video').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 40) || 'video';
  } catch { return 'video'; }
}
function newTask(url, name) {
  return { id: uid(), url, name: (name || '').trim(), kind: guessKind(url),
    status: 'queued', progress: 0, stage: '排队中', error: '',
    outDir: '', files: [], log: '', pid: null,
    speed: 0, downloaded: 0,
    createdAt: now(), updatedAt: now() };
}
function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile())
      .map((d) => { const p = path.join(dir, d.name); let size = 0; try { size = fs.statSync(p).size; } catch {} return { name: d.name, size }; });
  } catch { return []; }
}
function rmDirIfExists(p) { try { if (p && fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function parseProgress(log, kind) {
  log = stripAnsi(log);
  if (kind === 'hls') {
    // N_m3u8DL-RE 真实输出形如 "489/1094  1.54GB/3.48GB  3.48MBps  ..." 与独立的 "44.70%" 行
    const m = [...log.matchAll(/(\d+(?:\.\d+)?)%/g)];
    if (m.length) return Math.min(100, Number(m[m.length - 1][1]));
    if (/ffmpeg merging|转faststart/i.test(log)) return 96;
    if (/RE_EXIT=0/.test(log)) return 99;
  }
  if (kind === 'yt') {
    // yt-dlp: "[download]  12.3% of   50.00MiB at ..."
    const m = [...log.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+\d+(?:\.\d+)?\s*(?:Gi?B|Mi?B|Ki?B)/g)];
    if (m.length) return Math.min(100, Number(m[m.length - 1][1]));
    if (/(?:has already been downloaded|Finished downloading|\[download\]\s+100%)/i.test(log)) return 100;
    if (/\[download\]/i.test(log)) return 30;
    if (/Extracting|Parsing|正在解析|获取信息/i.test(log)) return 10;
  }
  if (/落盘目录：/.test(log)) return 99;
  if (/抓取页面/.test(log)) return 15;
  if (/开始下载|downloading/i.test(log)) return 40;
  return 0;
}
function parseSize(s) {
  const n = parseFloat(s); if (isNaN(n)) return 0;
  if (/Gi?B/i.test(s)) return Math.round(n * 1024 * 1024 * 1024);
  if (/Mi?B/i.test(s)) return Math.round(n * 1024 * 1024);
  if (/Ki?B/i.test(s)) return Math.round(n * 1024);
  return Math.round(n);
}
// RE 的日志混了 ANSI 颜色转义（^[[39;49m 之类），正则解析前先剥掉，否则 [数字]% 后面的总大小抓取不到
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''); }
// RE 日志里总大小在百分比行："8.28%    2.55GB"
// 严格版：只认"整行就一个百分比 + 一个尺寸"的干净行。
// 之前用松散匹配会跨行/抓到速度、磁盘等无关数字，一度把总量显示成 96GB / 71GB —— 宁可显示不出来，也不能显示错。
function parseTotal(log) {
  log = stripAnsi(log);
  // yt-dlp: "[download]  12.3% of   50.00MiB at ..."
  const m2 = [...log.matchAll(/\[download\][^\n]*?of\s+(\d+(?:\.\d+)?)\s*(Gi?B|Mi?B|Ki?B)/g)];
  if (m2.length) return parseSize(m2[m2.length - 1][1] + m2[m2.length - 1][2]);
  const lines = log.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].replace(/\r/g, '').match(/^\s*(\d+(?:\.\d+)?)%[ \t]+(\d+(?:\.\d+)?)[ \t]*(GB|MB|KB)[ \t]*$/);
    if (m) return parseSize(m[2] + m[3]);
  }
  return 0;
}
function stageOf(log) {
  if (/ffmpeg|merging|remux|转faststart/i.test(log)) return '合并/转码';
  if (/\[download\]|开始下载|Downloading/i.test(log)) return '下载中';
  if (/Extracting|Parsing|正在解析|获取信息|Loading URL|抓取页面/i.test(log)) return '解析中';
  if (/落盘目录：|after_move|Finished downloading/i.test(log)) return '已完成';
  return '进行中';
}
// 失败时把底层报错换成一句人话，并按类型给出是否可续传（避免对死链/反爬反复自动重试）
function classifyError(txt, code) {
  const lines = String(txt).split('\n').map(s => stripAnsi(s).replace(/\r/g, '')).filter(Boolean);
  const text = lines.join(' ');
  const find = (re) => { const l = lines.find(x => re.test(x)); return l ? l.trim() : null; };
  // YouTube 反爬：需登录 cookie，重试也没用
  if (/Sign in to confirm you'?re not a bot|confirm you'?re not a bot|not a bot/i.test(text))
    return { msg: 'YouTube 反爬：需登录 cookie 才能下（这台机器暂不支持）', retryable: false };
  // 抖音：需要浏览器 JS 签名（a_bogus/UIFID），yt-dlp 稳定版与 nightly 均拿不到 detail JSON，重试无意义
  if (/douyin\.com|Fresh cookies/i.test(text) && /douyin/i.test(text))
    return { msg: '抖音反爬升级：需浏览器内 JS 签名才能取流，yt-dlp 当前下不动（非本机环境问题）', retryable: false };
  // 地区/会员/隐私：不会因重试变好
  if (/not available in your country|This (?:video|content) (?:is not|isn.t) available|members only|Premium only|private video|has been removed|Video unavailable|Geo-/i.test(text))
    return { msg: '该视频地区/会员/隐私受限，下不动', retryable: false };
  // 链接失效 / 404 / 无效 URL：死链，重试无意义
  if (/is not a valid URL|Unable to download|HTTP Error 404|404:? Not Found|does not exist|no such page|Invalid data found|page not found/i.test(text))
    return { msg: '链接无效或已失效（贴完整链接再试）', retryable: false };
  // 网络类：代理/源站抖一下，续传通常能成 → 可自动重试
  if (/Connection (?:refused|reset)|timed? ?out|Read timed out|Network is unreachable|Name or service not known|ECONNRESET|ETIMEDOUT|断流|CDN|abort/i.test(text))
    return { msg: '网络波动（代理/源站不稳，自动重试中）', retryable: true };
  // RE（HLS 下载器）那一大坨 .NET 堆栈：取带含义的一行，沿用之前的判断
  const re = find(/断流|CDN|timeout|timed out|connection|refused|exception|error|失败|中断|reset|abort/i);
  if (re) {
    const m = re.slice(0, 200);
    return { msg: m, retryable: /断流|CDN|connection|refused|timeout|timed out|中断|reset|abort/i.test(m) };
  }
  return { msg: code != null ? `下载工具退出码 ${code}` : '下载失败', retryable: false };
}

const queue = [];
const running = new Set();
function enqueue(t) { queue.push(t); db.tasks.unshift(t); save(); pump(); }
function touch(t) { t.updatedAt = now(); }
function duBytes(dir) {
  try {
    const out = execFileSync('du', ['-sb', dir], { encoding: 'utf8', timeout: 4000 }).trim();
    return parseInt(out.split(/\s+/)[0], 10) || 0;
  } catch { return 0; }
}
// 可用磁盘空间（字节），df -B1 第 4 列；查不到就返回 0（跳过预检，不误杀）
function freeBytes(dir) {
  try {
    const out = execFileSync('df', ['-B1', dir], { encoding: 'utf8', timeout: 4000 }).trim().split('\n');
    const cols = out[out.length - 1].split(/\s+/);
    return parseInt(cols[3], 10) || 0;
  } catch { return 0; }
}

// 实时下载速度：每秒量一次下载根目录的真实字节数，delta/秒 = 真实磁盘写入速率（非估算）
let _duPrev = 0, _duInit = false, _gSpeed = 0;
setInterval(() => {
  try {
    if (!fs.existsSync(cfg.downloadDir)) { _duPrev = 0; return; }
    if (!_duInit) { _duPrev = duBytes(cfg.downloadDir) + duBytes(cfg.tempDir); _duInit = true; return; }
    const cur = duBytes(cfg.downloadDir) + duBytes(cfg.tempDir);
    const inst = Math.max(0, cur - _duPrev);
    _duPrev = cur;
    _gSpeed = Math.round(_gSpeed * 0.5 + inst * 0.5);
    let anyDown = false;
    for (const t of db.tasks) {
      if (t.status === 'downloading') {
        anyDown = true;
        t.speed = _gSpeed;
        // 直接量本任务在 tmp_down 下的真实写出目录（含断点续传已下的部分），比“全局增量”准
        const tp = (t.outDir && fs.existsSync(t.outDir)) ? duBytes(t.outDir) : (fs.existsSync(path.join(cfg.tempDir, t.name)) ? duBytes(path.join(cfg.tempDir, t.name)) : 0);
        t.downloaded = tp || Math.max(0, cur - (t._baseBytes || 0));
      }
    }
    if (!anyDown) _gSpeed = 0;
  } catch {}
}, 1000);
function pump() {
  while (running.size < CONCURRENCY && queue.length) {
    const t = queue.shift();
    running.add(t);
    run(t).finally(() => { running.delete(t); pump(); });
  }
}
function killTask(t) { if (t.pid) { try { process.kill(-t.pid, 'SIGTERM'); } catch {} } }
// 进程组是否还活着（用于判断“卡在 downloading”的任务是不是僵尸，避免复用死任务）
function isAlive(pid) { if (!pid) return false; try { process.kill(-pid, 0); return true; } catch { return false; } }

async function run(t) {
  const log = logPath(t.id);
  fs.writeFileSync(log, '');
  t.log = log; t.status = 'downloading'; t.stage = '启动'; t.progress = 5;
  t.speed = 0; t.downloaded = 0; t._baseBytes = duBytes(cfg.downloadDir) + duBytes(cfg.tempDir);

  // 不预先判断平台：m3u8→HLS 专用下载器；小红书→小红书下载器；其它一律交给 yt-dlp
  // （yt-dlp 自己能解析 小红书/B站/抖音/快手/TikTok，包括 b23.tv 这类短链，不用我们操心）
  touch(t); save();

  let cmd, args;
  const target = firstUrl(t.url) || t.url; // 兼容粘贴"分享文案"而非纯链接
  if (t.kind === 'xhs') {
    cmd = cfg.python3; args = [path.join(SCRIPTS, 'xhs_note.py'), target, '--out', cfg.downloadDir];
  } else if (t.kind === 'hls') {
    t.name = t.name || deriveName(t.url);
    cmd = 'bash'; args = [path.join(SCRIPTS, 'dl_hls.sh'), target, t.name, cfg.downloadDir];
  } else { // yt —— 全平台兜底：bilibili / 抖音 / douyin / tiktok / 微博 / 快手 …
    t.name = (t.name || deriveName(t.url)).replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 80) || 'video';
    const outDir = path.join(cfg.downloadDir, t.name);
    fs.mkdirSync(outDir, { recursive: true });
    t.outDir = outDir; // 提前设好，速度监控可直接量本任务目录
    cmd = cfg.ytDlp; args = ['--no-warnings', '--newline', '--format', 'bv*+ba/b',
      '-o', path.join(outDir, '%(title)s.%(ext)s'), '--print', 'after_move:filepath', target];
  }
  // 国内站点直连（不走代理）：更快，且 B站/抖音 的视频 CDN 经代理会卡死。外站仍走代理。
  const childEnv = { ...process.env, PATH: (cfg.binPath ? cfg.binPath + ':' : '') + process.env.PATH, DLM_LOG: log };
  const cnDirect = (t.kind === 'xhs' || t.kind === 'hls') || (t.kind === 'yt' && isCnUrl(t.url));
  if (cnDirect) { for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete childEnv[k]; }
  childEnv.NO_PROXY = CN_NOPROXY + ',' + (process.env.NO_PROXY || '');
  childEnv.no_proxy = childEnv.NO_PROXY;
  // 磁盘预检：剩余 < 1GB 直接失败，别把盘写满导致一连串下载崩
  try {
    const free = freeBytes(cfg.downloadDir);
    if (free && free < 1024 * 1024 * 1024) {
      t.status = 'failed'; t.stage = '失败'; t.error = `磁盘空间不足（剩 ${Math.round(free / 1073741824 * 10) / 10}GB），先清理再来`; t.pid = null;
      touch(t); save();
      return;
    }
  } catch {}
  const fh = fs.openSync(log, 'a');
  // 直接把子进程 stdout/stderr 写进日志文件（用 fd，不经管道），避免 detached 子进程因管道缓冲被卡死
  const child = spawn(cmd, args, { cwd: SCRIPTS, detached: true, env: childEnv, stdio: ['ignore', fh, fh] });
  child.unref();
  t.pid = child.pid;
  touch(t); save();

  const timer = setInterval(() => {
    try {
      const txt = fs.readFileSync(log, 'utf8');
      t.progress = Math.max(t.progress, parseProgress(txt, t.kind));
      t.stage = stageOf(txt);
      const sz = parseTotal(txt); if (sz) t.size = sz;
      touch(t);
    } catch {}
  }, 2000);

  const code = await new Promise((res) => child.on('exit', res));
  clearInterval(timer);
  try { fs.closeSync(fh); } catch {}
  const txt = fs.readFileSync(log, 'utf8');

  if (code === 0) {
    let outDir = t.outDir || '';
    if (!outDir) {
      // 目录名可能含空格，必须取到行尾
      const m = txt.match(/落盘目录：[ \t]*(.+)/) || txt.match(/跳过：[ \t]*(.+)/) || txt.match(/\[完成\][ \t]+(\S+\.mp4)/);
      if (m) outDir = m[1].trim();
      if (!outDir && t.kind === 'hls') outDir = path.join(cfg.downloadDir, t.name);
      if (t.kind === 'xhs') { t.outDir = outDir; if (outDir) t.name = path.basename(outDir.endsWith('.mp4') ? path.dirname(outDir) : outDir); }
      else t.outDir = outDir && outDir.endsWith('.mp4') ? path.dirname(outDir) : outDir;
    }
    if (t.kind === 'yt') {
      finalizeYt(t);
      // yt：文件夹名/任务名从 URL 标识（如视频ID）改成视频真实标题
      try {
        const vids = fs.readdirSync(t.outDir).filter(f => /\.(mp4|webm|mkv|mov|flv|m4v)$/i.test(f));
        if (vids.length) {
          const title = vids[vids.length - 1].replace(/\.[^.]+$/, '');
          const newName = title.replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 80);
          const newDir = path.join(cfg.downloadDir, newName);
          if (newName && newName !== t.name && !fs.existsSync(newDir)) {
            fs.renameSync(t.outDir, newDir); t.name = newName; t.outDir = newDir;
          }
        }
      } catch {}
    }
    t.files = t.outDir ? listFiles(t.outDir) : [];
    // yt 可能下到的是网页而非视频（short 链失效/需浏览器跳转），核实一下，避免假“完成”
    if (t.kind === 'yt' && !t.files.some(f => /\.(mp4|webm|mkv|mov|flv|m4v)$/i.test(f.name))) {
      t.status = 'failed'; t.stage = '失败';
      t.error = '未解析出可下载视频（短链可能已失效或需浏览器跳转，请贴完整网址，如 bilibili.com/video/BV…）';
    } else {
      t.status = 'done'; t.progress = 100; t.stage = '已完成'; t.error = '';
    }
    t.downloaded = duBytes(t.outDir); t.size = t.downloaded; t.speed = 0;
  } else {
    const ce = classifyError(txt, code);
    t.error = ce.msg;
    // 网络抖一下（CDN 断流/代理不稳）→ 自动续传重试；死链/反爬/受限 → 直接失败，不空转重试
    if (ce.retryable && (t.retries || 0) < MAX_AUTO_RETRY) {
      t.retries = (t.retries || 0) + 1;
      t.status = 'queued'; t.progress = 5; t.stage = `自动重试 ${t.retries}/${MAX_AUTO_RETRY}（续传）`; t.pid = null;
      touch(t); save();
      setTimeout(() => { queue.push(t); pump(); }, 6000);
      return;
    }
    t.status = 'failed'; t.stage = '失败';
  }
  t.pid = null; touch(t); save();
}

// yt-dlp 完成后：把主 mp4 转 faststart（moov 前置，网页拖动流畅）+ 写 来源.txt / meta.json
function finalizeYt(t) {
  const dir = t.outDir; if (!dir || !fs.existsSync(dir)) return;
  const vids = fs.readdirSync(dir).filter((f) => /\.mp4$/i.test(f));
  if (vids.length) {
    vids.sort((a, b) => fs.statSync(path.join(dir, a)).size - fs.statSync(path.join(dir, b)).size);
    const main = path.join(dir, vids[vids.length - 1]);
    const tmp = main + '.faststart.mp4';
    try {
      execFileSync(cfg.ffmpeg, ['-y', '-i', main, '-c', 'copy', '-movflags', '+faststart', tmp], { timeout: 180000, stdio: 'ignore' });
      if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) fs.renameSync(tmp, main); else if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
  }
  const meta = { source: 'yt-dlp', name: t.name, url: t.url, downloadedAt: now() };
  try { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1)); } catch {}
  const src = `【来源 —— 你给的链接】\n链接: ${t.url}\n下载时间: ${now()}\n工具: yt-dlp（全平台）\n`;
  try { fs.writeFileSync(path.join(dir, '来源.txt'), src); } catch {}
}

// 仍在跑的下载（热重载或进程重启后）重新接管监控：轮询它的日志，进度/总量照常更新，RE 退出时收尾
function resumeMonitor(t) {
  const timer = setInterval(() => {
    try {
      const txt = fs.readFileSync(t.log, 'utf8');
      t.progress = Math.max(t.progress, parseProgress(txt, t.kind));
      t.stage = stageOf(txt);
      const sz = parseTotal(txt); if (sz) t.size = sz;
      const tp = (t.outDir && fs.existsSync(t.outDir)) ? duBytes(t.outDir) : (fs.existsSync(path.join(cfg.tempDir, t.name)) ? duBytes(path.join(cfg.tempDir, t.name)) : 0);
      if (tp) t.downloaded = tp;
      const m = txt.match(/RE_EXIT=(\d+)/);
      if (m) {
        clearInterval(timer); clearInterval(guard);
        if (m[1] === '0') {
          let outDir = '';
          const mm = txt.match(/落盘目录：[ \t]*(.+)/) || txt.match(/跳过：[ \t]*(.+)/) || txt.match(/\[完成\][ \t]+(\S+\.mp4)/);
          if (mm) outDir = mm[1].trim();
          if (!outDir && t.kind === 'hls') outDir = path.join(cfg.downloadDir, t.name);
          if (t.kind === 'xhs') t.outDir = outDir; else t.outDir = outDir && outDir.endsWith('.mp4') ? path.dirname(outDir) : outDir;
          t.files = t.outDir ? listFiles(t.outDir) : [];
          t.status = 'done'; t.progress = 100; t.stage = '已完成'; t.error = '';
          t.downloaded = duBytes(t.outDir); t.size = t.downloaded; t.speed = 0;
        } else { t.status = 'failed'; t.stage = '失败'; t.error = classifyError(txt, Number(m[1])).msg; }
        t.pid = null; touch(t); save(); return;
      }
      touch(t);
    } catch {}
  }, 2000);
  const guard = setInterval(() => {
    if (!isAlive(t.pid)) {
      clearInterval(timer); clearInterval(guard);
      if (t.status === 'downloading') { t.status = 'stopped'; t.stage = '已中断'; t.pid = null; touch(t); save(); }
    }
  }, 5000);
}
// 热重载/网关重启：进程还活着 → 重新接管；进程已死 → 才标已停止（老逻辑无脑全标 stopped，会误杀在线下载）
for (const t of db.tasks) {
  if (t.status === 'downloading' || t.status === 'queued') {
    if (isAlive(t.pid)) resumeMonitor(t);
    else if (t.status === 'queued') { queue.push(t); pump(); }
    else { t.status = 'stopped'; t.stage = '网关重启，已中断'; t.pid = null; }
  }
}
save();

// ───────────────────────── HTTP ─────────────────────────
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', ...headers });
  res.end(data);
}
async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 1e6) break; chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
function sanitize(p) {
  const abs = path.resolve(String(p || ''));
  const base = path.resolve(cfg.downloadDir);
  return (abs === base || abs.startsWith(base + path.sep)) ? abs : null;
}
// 同一 URL 的“已停止/失败/完成”任务视为重复记录，移除之（keepId 除外），
// 避免列表里堆一堆同一下载的重复卡片（用户重贴同链接点下载时不再新建重复）。
function pruneDups(u, keepId) {
  for (let i = db.tasks.length - 1; i >= 0; i--) {
    const t = db.tasks[i];
    if (t.id === keepId) continue;
    if ((t.url || '').trim() === u && ['stopped', 'failed', 'done'].includes(t.status)) {
      killTask(t);
      db.tasks.splice(i, 1);
    }
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.txt': 'text/plain', '.log': 'text/plain' };

async function handler(request, response) {
  const url = request.url || '/';
  let sub = decodeURIComponent(url.slice(PREFIX.length).split('?')[0]);
  if (sub.startsWith('/')) sub = sub.slice(1);
  const q = new URL(url, 'http://x').searchParams;
  try {
    if (sub === '' || sub === '/') {
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__DLM_VERSION__', 'v' + PLUGIN_VERSION);
      // 网关下发的鉴权 cookie 是 SameSite=Strict，面板内 fetch(XHR) 带不上 → 列表只能整页刷新才出数据。
      // 面板 HTML 走文档导航（Strict 带得上），这里用同一份 token 再发一个 SameSite=Lax 的 cookie，
      // 之后面板里的 fetch 就能带 cookie，列表/状态实时刷新，不用整页刷新。
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
      const authCookie = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('dsh-auth'));
      if (authCookie) headers['Set-Cookie'] = `${authCookie}; Path=/; Max-Age=2592000; SameSite=Lax`;
      return send(response, 200, html, headers);
    }
    if (sub === 'api/tasks') {
      if (request.method === 'GET') {
        // 内容被移走/删除的已完成任务，记录自动消失（用户想要的行为）
        const n0 = db.tasks.length;
        db.tasks = db.tasks.filter(t => !(t.status === 'done' && t.outDir && !fs.existsSync(t.outDir)));
        if (db.tasks.length !== n0) save();
        // 列表也补发 Lax cookie：即便 HTML 那次被网关的 Strict 覆盖，轮询请求也能带上鉴权
        const headers = {};
        const lc = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('dsh-auth'));
        if (lc) headers['Set-Cookie'] = `${lc}; Path=/; Max-Age=2592000; SameSite=Lax`;
        return send(response, 200, { tasks: db.tasks }, headers);
      }
      const b = await readBody(request);
      if (!b.url) return send(response, 400, { error: '缺少 url' });
      const u = (b.url || '').trim();
      // 同 URL 的 downloading/queued 但进程已死（僵尸/卡死）→ 先移除，避免“复用”到一个死任务
      for (let i = db.tasks.length - 1; i >= 0; i--) {
        const t = db.tasks[i];
        if ((t.url || '').trim() === u && (t.status === 'downloading' || t.status === 'queued') && !isAlive(t.pid)) {
          killTask(t); db.tasks.splice(i, 1);
        }
      }
      // 同 URL 仍活跃（下载/排队且进程活着）→ 复用，不新建
      const a = db.tasks.find(x => (x.url || '').trim() === u && (x.status === 'downloading' || x.status === 'queued'));
      if (a) return send(response, 200, { task: a });
      pruneDups(u, null);
      const t = newTask(u, b.name); enqueue(t);
      save();
      return send(response, 200, { task: t });
    }
    let m = sub.match(/^api\/tasks\/([^/]+)\/action$/);
    if (m && request.method === 'POST') {
      const t = db.tasks.find((x) => x.id === m[1]);
      if (!t) return send(response, 404, { error: '任务不存在' });
      const { action } = await readBody(request);
      if (action === 'delete') {
        if (['downloading', 'queued'].includes(t.status)) killTask(t);
        db.tasks = db.tasks.filter((x) => x.id !== t.id); save();
        return send(response, 200, { ok: true });
      }
      if (action === 'deleteFiles') {
        if (['downloading', 'queued'].includes(t.status)) killTask(t);
        if (t.outDir && fs.existsSync(t.outDir)) fs.rmSync(t.outDir, { recursive: true, force: true });
        rmDirIfExists(path.join(cfg.tempDir, t.name)); // 清掉 HLS 下载器留在 tmp_down 的临时目录
        db.tasks = db.tasks.filter((x) => x.id !== t.id); save();
        return send(response, 200, { ok: true });
      }
      if (action === 'retry') {
        killTask(t);
        const nt = newTask(t.url, t.name);
        db.tasks = db.tasks.filter((x) => x.id !== t.id);
        pruneDups((t.url || '').trim(), nt.id);
        enqueue(nt);
        save();
        return send(response, 200, { task: nt });
      }
      if (action === 'stop') {
        killTask(t);
        if (t.status === 'downloading' || t.status === 'queued') { t.status = 'stopped'; t.stage = '已停止'; }
        touch(t); save();
        return send(response, 200, { ok: true });
      }
      return send(response, 400, { error: '未知操作' });
    }
    // === 读写配置 API ===
    if (sub === 'api/config') {
      if (request.method === 'GET') {
        return send(response, 200, { cfg, env: { PY: cfg.python3, YTDLP: cfg.ytDlp, FFMPEG: cfg.ffmpeg, RE_BIN: cfg.re, DLM_DOWNLOAD_DIR: cfg.downloadDir, DLM_TMP: cfg.tempDir } });
      }
      if (request.method === 'POST') {
        const b = await readBody(request);
        if (!b || b.cfg === undefined) return send(response, 400, { error: '缺少 cfg' });
        try {
          fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(b.cfg, null, 1));
          cfg = loadConfig();
          return send(response, 200, { ok: true, cfg });
        } catch (e) { return send(response, 500, { error: String((e && e.message) || e) }); }
      }
    }
    m = sub.match(/^api\/tasks\/([^/]+)$/);
    if (m && request.method === 'GET') {
      const t = db.tasks.find((x) => x.id === m[1]);
      return t ? send(response, 200, { task: t }) : send(response, 404, { error: '任务不存在' });
    }
    m = sub.match(/^api\/log\/([^/]+)$/);
    if (m) {
      const f = logPath(m[1]);
      const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').slice(-40).join('\n') : '';
      return send(response, 200, { log: txt });
    }
    if (sub === 'api/reveal' && request.method === 'POST') {
      const body = await readBody(request);
      const abs = sanitize(body.path);
      if (!abs || !fs.existsSync(abs)) return send(response, 404, { error: '路径不存在' });
      const isDir = fs.statSync(abs).isDirectory();
      // 在系统文件管理器中打开：目录直接打开；文件则打开并选中。仅允许 downloadDir 内路径（sanitize 已校验）。
      let cmd, args;
      if (process.platform === 'darwin') { cmd = 'open'; args = isDir ? [abs] : ['-R', abs]; }
      else if (process.platform === 'win32') { cmd = 'explorer'; args = isDir ? [abs] : ['/select,', abs]; }
      else { cmd = 'xdg-open'; args = [isDir ? abs : path.dirname(abs)]; }
      try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
        return send(response, 200, { ok: true });
      } catch (e) { return send(response, 500, { error: String((e && e.message) || e) }); }
    }
    if (sub === 'api/file') {
      const abs = sanitize(q.get('path') || '');
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(response, 404, { error: '文件不存在' });
      const size = fs.statSync(abs).size;
      const ext = path.extname(abs).toLowerCase();
      response.setHeader('Accept-Ranges', 'bytes');
      const mime = MIME[ext] || 'application/octet-stream';
      // 文本类带 charset，避免中文乱码（尤其新标签打开时）
      response.setHeader('Content-Type', /text\/|\/json/.test(mime) ? mime + '; charset=utf-8' : mime);
      const range = request.headers.range;
      if (range) {
        const mm = range.match(/bytes=(\d*)-(\d*)/);
        const start = mm && mm[1] ? parseInt(mm[1], 10) : 0;
        let end = mm && mm[2] ? parseInt(mm[2], 10) : size - 1;
        if (end >= size) end = size - 1;
        response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(abs, { start, end }).pipe(response);
      } else {
        response.writeHead(200, { 'Content-Length': size });
        fs.createReadStream(abs).pipe(response);
      }
      return;
    }
    send(response, 404, { error: 'not found' });
  } catch (e) {
    send(response, 500, { error: String((e && e.message) || e) });
  }
}

export { handler };
