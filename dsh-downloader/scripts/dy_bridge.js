// 抖音下载桥接：yt-dlp 已无法解析抖音（detail 接口要求浏览器内 JS 签名 a_bogus/UIFID）。
// 本脚本经 ego-browser 在真实浏览器页内 fetch aweme detail 接口（页内自带签名与 cookie），
// 拿到 play_addr / images 的 CDN 直链后，用 curl 直连下载（CDN 本身不反爬，已实测）。
// 由 engine.js spawn：`node ego-browser.mjs < 本脚本`，参数走环境变量 DY_URL / DY_OUT。
// 日志行刻意模仿 yt-dlp 的 "[download]  x% of  NNN.NNMiB at ..."，引擎复用同一套进度解析。

const cp = (await import('node:child_process')).default;
const fs = (await import('node:fs')).default;
const path = (await import('node:path')).default;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const target = process.env.DY_URL || '';
const outDir = process.env.DY_OUT || '';
const log = (s) => console.log(s);
const die = (s) => { log(`[dy] 失败: ${s}`); process.exit(1); };

function curl(args, timeoutMs = 300000) {
  const r = cp.spawnSync('curl', args, { encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status, out: (r.stdout || '').trim() };
}

// 1) 解析出 aweme id（分享短链 → 跟随重定向取最终 URL；直接贴的链接正则抠 id）
let id = (target.match(/\/(?:video|note|slides)\/(\d{10,25})/) || [])[1] || null;
if (!id) {
  const r = curl(['-s', '-o', '/dev/null', '-w', '%{url_effective}', '-L', '-m', '20', '-A', UA_M, target], 30000);
  id = (r.out.match(/\/(?:share\/)?(?:video|note|slides)\/(\d{10,25})/) || [])[1] || null;
}
if (!id) die('链接里找不到抖音作品 id（贴 App 分享的 v.douyin.com 链接或完整网址）');
log(`[dy] aweme id = ${id}`);

// 2) 确保有一个 douyin.com 同源页面（页内 fetch 才能带签名与 cookie）
try {
  const info = await page.info();
  if (!/douyin\.com/.test(info.url || '')) await page.goto('https://www.douyin.com/');
} catch (e) { die(`浏览器不可用：${e}`); }

// 3) 页内 fetch detail 接口（浏览器自动附加 a_bogus/msToken 签名）
const detail = await page.evaluate(async (vid) => {
  const u = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=' + vid +
    '&pc_client_type=1&version_code=190500&version_name=19.5.0&cookie_enabled=true&screen_width=2560&screen_height=1440&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Chrome&browser_version=131.0.0.0&platform=PC';
  try {
    const r = await fetch(u, { credentials: 'include', signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, head: t.slice(0, 120) };
  } catch (e) { return { err: String(e) }; }
}, id);

if (detail.err) die(`页内请求异常：${detail.err}`);
const aweme = detail.json && detail.json.aweme_detail;
if (!aweme) die(`detail 接口未返回数据（HTTP ${detail.status}：${String(detail.head || '').replace(/\n/g, ' ')}）。可能需要在 ego 浏览器窗口里登录抖音`);

const title = String(aweme.desc || 'douyin_' + id).replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 60) || ('douyin_' + id);
const images = Array.isArray(aweme.images) ? aweme.images : [];
const video = aweme.video || {};
log(`[dy] 《${title}》 类型=${aweme.aweme_type} 图${images.length}张`);

// 3.5) 按标题改名目录（engine 预建的目录名是 URL 里的 id）
let dir = outDir;
const wantDir = path.join(path.dirname(outDir), title);
if (title && fs.existsSync(outDir) && !fs.existsSync(wantDir)) { try { fs.renameSync(outDir, wantDir); dir = wantDir; } catch {} }
fs.mkdirSync(dir, { recursive: true });

// 4) 下载（CDN 直链无需 cookie；带 Range 断点续传；监控线程按 yt-dlp 格式打进度）
function totalSize(url) {
  const r = curl(['-s', '-I', '-m', '15', '-A', UA, url], 20000);
  const m = r.out.match(/content-length:\s*(\d+)/i); return m ? Number(m[1]) : 0;
}
function magicExt(file) {
  try {
    const b = Buffer.alloc(12); const fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
    if (b.slice(4, 8).toString('latin1') === 'ftyp') {
      const brand = b.slice(8, 12).toString('latin1');
      return /M4A |mp42|m4a/.test(brand) ? '.m4a' : '.mp4';
    }
    if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
    if (b.slice(0, 4).toString('latin1') === 'RIFF') return '.webp';
    if (b[0] === 0x89) return '.png';
  } catch {}
  return null;
}
function dl(url, base) {
  let tmp = path.join(dir, base + '.part');
  const child = cp.spawn('curl', ['-s', '-f', '-L', '-C', '-', '--speed-time', '30', '--speed-limit', '2000', '-A', UA, '-o', tmp, url]);
  const t0 = Date.now();
  const mon = setInterval(() => {
    try {
      if (!totalCache.has(url)) totalCache.set(url, totalSize(url));
      const have = fs.statSync(tmp).size;
      const tot = totalCache.get(url) || 0;
      if (!tot) return;
      const pct = tot ? Math.min(99, (have / tot * 100)) : 0;
      log(`[download] ${pct.toFixed(1)}% of ${(tot / 1048576).toFixed(2)}MiB at ${(have / Math.max(1, (Date.now() - t0) / 1000) / 1048576).toFixed(2)}MiB/s`);
    } catch {}
  }, 2000);
  return new Promise((res) => child.on('close', (code) => {
    clearInterval(mon);
    if (code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) { try { fs.unlinkSync(tmp); } catch {} res(null); return; }
    // 魔数纠正扩展名（抖音图文帖的 play_addr 常是纯音频 m4a）
    const ext = magicExt(tmp);
    let dest = path.join(dir, base + (ext && !base.endsWith(ext) ? ext : ''));
    if (dest === path.join(dir, base)) dest = path.join(dir, base + (ext || '.bin'));
    try { fs.renameSync(tmp, dest); } catch { dest = tmp; }
    const sz = fs.statSync(dest).size;
    log(`[download] 100% of ${(sz / 1048576).toFixed(2)}MiB at 0.00MiB/s`);
    res(dest);
  }));
}
const totalCache = new Map();
const files = [];
if (images.length) {
  // 图文帖：逐张下载（签名 URL 直接用；尝试 webp→jpeg 高清变体，失败回退）
  let i = 0;
  for (const im of images) {
    i++;
    const list = (im.url_list || []).filter(u => /x-signature/.test(u));
    const url = list[0] || (im.url_list || [])[0];
    if (!url) continue;
    const base = String(i).padStart(2, '0');
    let got = await dl(url.replace(/~tplv-dy-aweme-images:q75\.webp/, '~tplv-dy-aweme-images:q75.jpeg'), base);
    if (!got) got = await dl(url, base);
    if (got) files.push(got);
  }
  // 图文帖背景音乐也留一份
  const au = ((video.play_addr || {}).url_list || [])[0];
  if (au) { totalCache.set(au, totalSize(au)); const g = await dl(au, title.slice(0, 30) + '_bgm'); if (g) files.push(g); }
} else {
  const urls = ((video.play_addr || {}).url_list || []);
  if (!urls.length) die('作品里没有可下载的播放地址（可能是纯图文且 images 为空）');
  for (const u of urls) {
    totalCache.set(u, totalSize(u));
    const got = await dl(u, title.slice(0, 40));
    if (got) { files.push(got); break; }
  }
}
if (!files.length) die('所有下载地址均失败（CDN 直链可能已过期，重试一次试试）');

// 5) 元信息 + 完成标记（engine 用「落盘目录：」定位产物）
try {
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    source: 'douyin-bridge', title, url: target, awemeId: id,
    downloadedAt: new Date().toISOString(), files: files.map(f => path.basename(f)),
  }, null, 1));
  fs.writeFileSync(path.join(dir, '来源.txt'), `【来源】\n链接: ${target}\n标题: ${title}\n下载时间: ${new Date().toISOString()}\n工具: 抖音桥接（浏览器签名取流 + CDN 直连）\n`);
} catch {}
log(`落盘目录：${dir}`);
process.exit(0);
