#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""小红书「笔记档案包」采集器 —— 统一模型版（自包含插件版）

═══ 核心抽象（本脚本的设计基石）═══
    笔记 = { 作者, 标题, 正文, 话题[], 数据{}, 媒体[], 评论[] }

**媒体就是一个列表**，不分「单图/多图/视频」：
    单图   -> media = [img]
    多图   -> media = [img, img, img, ...]
    视频   -> media = [video, cover]   （封面也是列表里的一项）
    多视频 -> media = [video, video, cover]
  → **抓到什么就是什么**，不为类型写分支。将来加 livephoto 也不用改结构。

标题 / 正文 / 评论 / 数据字段 / 文件命名 —— **全部统一规则**，与笔记类型无关。

为何自己写：yt-dlp 的 XiaoHongShu extractor 只取视频流（源码无 imageList），
图文帖会报 "No video formats found"。本脚本直接从页面 __INITIAL_STATE__ 挖数据。

已验证（2026-10-25 两条真实链接实测）：**单篇笔记页不需要登录**，图文/视频都能拿全数据。
（主页/搜索/发现页确实跳登录 —— 那是另一回事，别混为一谈。）

用法：
  python xhs_note.py <小红书链接或 xhslink 短链> [选项]

选项：
  --out 目录       落盘根目录（默认：环境变量 XHS_OUT 或 /ai/下载）
  --comments N     最多抓 N 条评论（默认 50，0=不抓）。**限量，不拔太多**
  --no-media       只存元数据+正文，不下载媒体
  --probe          只解析不下载（调试用）
  --force          台账里已有也强制重下

环境变量（引擎注入，优先于默认值）：
  XHS_OUT        - 成品目录
  XHS_PROXY      - 代理地址（如 http://127.0.0.1:10808，空=直连）
  XHS_UA         - 自定义 UA（默认移动端 iPhone UA）
  XHS_MAX_CMT    - 默认最大评论数
"""
import os
import re
import sys
import json
import time
import shutil
import urllib.parse
import urllib.request
import urllib.error

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.dirname(HERE)

# 环境变量优先，回落到默认值
XHS_OUT = os.environ.get("XHS_OUT", "/ai/下载")
XHS_PROXY = os.environ.get("XHS_PROXY", "")  # 空=直连
XHS_UA = os.environ.get("XHS_UA", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")
MAX_COMMENTS_DEFAULT = int(os.environ.get("XHS_MAX_CMT", "50"))
MAX_COMMENT_PAGES = 10

AUTHOR_MAX = 12
TITLE_MAX = 20

# ---------------------------------------------------------------- 台账功能已移除（引擎层已处理去重，避免依赖外部 dl.py）

def resolve_short(url):
    """xhslink.cn 短链 -> 真实地址。实测 302 到 /login?redirectPath=<编码后的真实地址>。"""
    if "xhslink.cn" not in url:
        return url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": XHS_UA})
        opener_kwargs = {}
        if XHS_PROXY:
            opener_kwargs["http"] = XHS_PROXY
            opener_kwargs["https"] = XHS_PROXY
        op = urllib.request.build_opener(urllib.request.ProxyHandler(opener_kwargs) if XHS_PROXY else None)
        r = op.open(req, timeout=25)
        final = r.geturl()
    except urllib.error.HTTPError as e:
        final = e.headers.get("Location") or ""
    except Exception:
        return url
    m = re.search(r"redirectPath=([^&]+)", final)
    if m:
        return urllib.parse.unquote(m.group(1))
    return final if "xiaohongshu.com" in final else url


def _with_param(url, key, val):
    """给 URL 加/改一个查询参数（用于评论翻页的 cursor）。"""
    parts = list(urllib.parse.urlparse(url))
    q = urllib.parse.parse_qs(parts[4])
    q[key] = [val]
    parts[4] = urllib.parse.urlencode(q, doseq=True)
    return urllib.parse.urlunparse(parts)


def fetch_html(url):
    handlers = []
    if XHS_PROXY:
        handlers.append(urllib.request.ProxyHandler({"http": XHS_PROXY, "https": XHS_PROXY}))
    op = urllib.request.build_opener(*handlers)
    op.addheaders = [("User-Agent", XHS_UA),
                     ("Accept-Language", "zh-CN,zh;q=0.9")]
    return op.open(url, timeout=30).read().decode("utf-8", "replace")


def get_initial_state(html):
    m = re.search(r'window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*</script>', html, re.S)
    return m.group(1) if m else None


def _json_cut(s, start):
    """从 start 处按括号配对截出一个完整 JSON 片段。"""
    open_ch = s[start]
    close_ch = {"[": "]", "{": "}"}.get(open_ch)
    if not close_ch:
        return None
    depth = 0
    for k in range(start, len(s)):
        if s[k] == open_ch:
            depth += 1
        elif s[k] == close_ch:
            depth -= 1
            if depth == 0:
                return s[start:k + 1]
    return None


def _find(s, key, default=None):
    m = re.search(r'"' + key + r'":"((?:[^"\\]|\\.)*)"', s)
    if m:
        try:
            return json.loads('"' + m.group(1) + '"')
        except Exception:
            return m.group(1)
    m = re.search(r'"' + key + r'":(-?\d+(?:\.\d+)?)', s)
    return m.group(1) if m else default


# ---------------------------------------------------------------- 文本清洗（统一规则）
def strip_topics(text):
    """标题用：#xxx[话题]# -> #xxx，压缩空白。"""
    if not text:
        return ""
    t = re.sub(r"#([^#\[]+)\[话题\]#", r"#\1", text)
    return re.sub(r"\s+", " ", t).strip()


def clean_body(text):
    """正文用：剥掉 [话题] 噪音，保留段落换行（可读性优先）。"""
    if not text:
        return ""
    t = text.replace("[话题]", "")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def derive_title(raw_title, desc):
    """统一标题规则：
    1) title 有值 -> 用它
    2) title 为空（小红书常态）-> 取 desc 首句，剥 #话题#
    3) 都没有 -> 空，由调用方回落 noteId
    """
    t = (raw_title or "").strip()
    if t:
        return strip_topics(t)
    if desc:
        first = re.split(r"[。！？\n!?]", strip_topics(desc))[0]
        return re.sub(r"#\S+", "", first).strip()[:40]
    return ""


def sanitize(name, maxlen=40):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(name or ""))
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:maxlen] or "untitled"


# ---------------------------------------------------------------- 解析
def parse_note(html, url, max_comments):
    """解析出一则笔记的完整数据。媒体统一进 note['media'] 列表。"""
    s = get_initial_state(html)
    if not s:
        raise RuntimeError("页面里没找到 __INITIAL_STATE__（可能要登录或链接失效）")
    s = s.replace("\\u002F", "/")

    note = {"url": url}
    note["noteId"] = _find(s, "noteId") or _find(s, "id") or ""
    note["type"] = _find(s, "type", "normal")

    desc = _find(s, "desc", "") or ""
    note["title"] = derive_title(_find(s, "title", "") or "", desc) or note["noteId"]
    note["desc"] = clean_body(desc)

    # 作者：页面里 user 块出现几十次（评论里全是）。真正的作者块有铁证：
    #   ① 字段是 **nickName（大写 N）**，评论用的是 nickname（小写 n）
    #   ② note 主体在 commentData 之前，故作者块是页面里靠前的那个
    # 只匹配 nickname 会跳过作者、误抓成评论者（实测抓成 "创点crowdfunding"）。
    author, uid = "", ""
    # ① 优先：作者块（nickName 大写）
    um = re.search(r'"user":\{[^{}]*?"userId":"([^"]+)"[^{}]*?"nickName":"((?:[^"\\]|\\.)*)"', s)
    if not um:
        um2 = re.search(r'"user":\{[^{}]*?"nickName":"((?:[^"\\]|\\.)*)"', s)
        if um2:
            raw = um2.group(1)
            try:
                author = json.loads('"' + raw + '"')
            except Exception:
                author = raw
    else:
        uid = um.group(1)
        raw = um.group(2)
        try:
            author = json.loads('"' + raw + '"')
        except Exception:
            author = raw
    if not author:
        # ② 兜底：第一个 user 块（note 主体先于评论）
        fm = re.search(r'"user":\{[^{}]*?"nickname":"((?:[^"\\]|\\.)*)"', s)
        if fm:
            uid = uid or _find(s, "userId", "") or ""
            try:
                author = json.loads('"' + fm.group(1) + '"')
            except Exception:
                author = fm.group(1)
    note["author"] = author or _find(s, "nickname", "") or ""
    note["userId"] = uid or _find(s, "userId", "") or ""
    note["redId"] = _find(s, "redId", "") or ""
    note["ipLocation"] = _find(s, "ipLocation", "") or ""

    ts = _find(s, "time")
    note["publishTime"] = (time.strftime("%Y-%m-%d %H:%M:%S",
                                         time.localtime(int(ts) / 1000))
                          if ts and str(ts).isdigit() else "")

    stats = {}
    for k in ("likedCount", "collectedCount", "commentCount", "shareCount"):
        v = _find(s, k)
        if v not in (None, ""):
            stats[k] = v
    note["stats"] = stats

    # 话题
    tags = []
    i = s.find('"tagList":[')
    if i > 0:
        seg = _json_cut(s, s.index("[", i))
        try:
            tags = [t["name"] for t in json.loads(seg) if t.get("name")]
        except Exception:
            pass
    note["tags"] = tags

    # ── 媒体：统一列表。抓到什么就是什么，不按类型分支 ──
    media = []

    # 图片（图文帖配图 / 视频帖封面，都在这里）
    i = s.find('"imageList":[')
    if i > 0:
        seg = _json_cut(s, s.index("[", i))
        try:
            for it in json.loads(seg):
                u = it.get("url") or ""
                if not u:
                    continue
                if u.startswith("//"):
                    u = "https:" + u
                media.append({"kind": "image", "url": u,
                              "width": it.get("width"), "height": it.get("height")})
        except Exception:
            pass

    # 视频：取码率最高的一路（本版只取 1 路；多视频时页面会有多组，同样进列表）
    best, best_br = None, -1
    for mt in re.finditer(
            r'"masterUrl":"([^"]+)".*?"avgBitrate":(\d+).*?'
            r'"width":(\d+).*?"height":(\d+).*?"duration":(\d+)', s, re.S):
        u, br = mt.group(1), int(mt.group(2))
        if br > best_br:
            best_br, best = br, {"kind": "video", "url": u, "bitrate": br,
                                 "width": int(mt.group(3)), "height": int(mt.group(4)),
                                 "durationMs": int(mt.group(5))}
    if not best:
        for u in re.findall(r'"masterUrl":"([^"]+)"', s):
            media.append({"kind": "video", "url": u})
            break
    else:
        media.append(best)

    note["media"] = media

    # 评论（分页采集，限量）
    comments = []
    seen = set()
    cursor = None
    page = 0
    while max_comments > 0 and len(comments) < max_comments and page < MAX_COMMENT_PAGES:
        page += 1
        if page == 1:
            html_i = html
        else:
            if not cursor:
                break
            try:
                html_i = fetch_html(_with_param(url, "cursor", cursor))
            except Exception:
                break
        si = get_initial_state(html_i)
        if not si:
            break
        si = si.replace("\\u002F", "/")
        ci = si.find('"commentData":{')
        if ci < 0:
            break
        arr_i = si.find('"comments":[', ci)
        if arr_i < 0:
            break
        seg = _json_cut(si, si.index("[", arr_i))
        try:
            arr = json.loads(seg)
        except Exception:
            arr = []
        got = 0
        for c in arr:
            if len(comments) >= max_comments:
                break
            txt = (c.get("content") or "").strip()
            cid = c.get("id") or txt
            if not txt or cid in seen:
                continue
            seen.add(cid)
            comments.append({
                "user": (c.get("user") or {}).get("nickname", ""),
                "content": txt,
                "liked": c.get("likeCount", 0),
                "ip": c.get("ipLocation", ""),
            })
            got += 1
        # 下一页游标
        nc = re.search(r'"commentData":\{.*?"cursor":"([^"]+)"', si, re.S)
        new_cursor = nc.group(1) if nc else None
        if not new_cursor or new_cursor == cursor or got == 0:
            break
        cursor = new_cursor
    note["comments"] = comments
    return note


# ---------------------------------------------------------------- 下载
def dl(url, dest, referer="https://www.xiaohongshu.com/"):
    handlers = []
    if XHS_PROXY:
        handlers.append(urllib.request.ProxyHandler({"http": XHS_PROXY, "https": XHS_PROXY}))
    op = urllib.request.build_opener(*handlers)  # 修上游 bug：原来无代理时 build_opener(None) 必抛 TypeError
    op.addheaders = [("User-Agent", XHS_UA), ("Referer", referer)]
    with op.open(url, timeout=180) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    return os.path.getsize(dest)


def media_filename(item, idx):
    """统一命名：按列表顺序 01.jpg / 02.jpg / 03.mp4 ...
    扩展名由 URL 推断，不按类型分文件。"""
    u = (item.get("url") or "").lower()
    if item.get("kind") == "video" or ".mp4" in u:
        ext = ".mp4"
    elif ".png" in u:
        ext = ".png"
    elif ".webp" in u:
        ext = ".webp"
    else:
        ext = ".jpg"
    return f"{idx:02d}{ext}"


def verify_complete(target, note):
    """🔴 完整性自检（强制）。

    用户要求：**每条笔记都必须完整**——全部配图 + 正文 + 评论 + 元数据，
    不能只下个封面就完事。所以每次下载后自动核对：
      ① 声明的媒体数 == 实际落盘的媒体文件数（少一个就报警）
      ② 每个媒体文件都非空
      ③ 正文已写入（desc.txt 存在且 meta.json 里 desc 也在）
      ④ 元数据必需字段齐全（作者/标题/noteId/userId/统计）
      ⑤ 评论：页面内置几条就几条（0 条只提示不判失败，因为源可能本就没有）

    返回 (ok, issues)
    """
    issues = []
    try:
        files = os.listdir(target)
    except Exception as e:
        return False, [f"无法列出目录: {e}"]

    # ① 媒体数量
    media = note.get("media", [])
    exts = (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm")
    real_media = [f for f in files if f.lower().endswith(exts)]
    if len(real_media) < len(media):
        issues.append(f"媒体缺失：声明 {len(media)} 项，实际落盘 {len(real_media)} 个")

    # ② 文件非空
    for x in media:
        fn = x.get("file")
        if not fn:
            issues.append(f"媒体未记录文件名（可能下载失败）: {str(x)[:60]}")
            continue
        p = os.path.join(target, fn)
        if not os.path.exists(p):
            issues.append(f"媒体文件不存在: {fn}")
        elif os.path.getsize(p) == 0:
            issues.append(f"媒体文件为空: {fn}")

    # ③ 正文
    desc_path = os.path.join(target, "desc.txt")
    if not os.path.exists(desc_path):
        issues.append("缺少 desc.txt")
    if not note.get("desc"):
        issues.append("正文为空")

    # ④ 元数据必需字段
    required = ["author", "title", "noteId", "userId", "stats", "tags"]
    for k in required:
        if k not in note:
            issues.append(f"meta 缺少字段: {k}")

    # ⑤ 评论（仅提示）
    if not note.get("comments"):
        note.setdefault("_notes", []).append("本条无评论（源可能就没有）")

    # ⑥ 来源留档（强制）
    src_path = os.path.join(target, "来源.txt")
    if not os.path.exists(src_path) or os.path.getsize(src_path) == 0:
        issues.append("缺少 来源.txt（原始链接/作者主页留档）")

    return (len(issues) == 0), issues


def main():
    argv = sys.argv[1:]
    url, out = None, XHS_OUT
    max_comments = MAX_COMMENTS_DEFAULT
    no_media = probe = force = False
    i = 0
    while i < len(argv):
        t = argv[i]
        if t == "--out":
            out = argv[i + 1]; i += 2
        elif t == "--comments":
            max_comments = int(argv[i + 1]); i += 2
        elif t == "--no-media":
            no_media = True; i += 1
        elif t == "--probe":
            probe = True; i += 1
        elif t == "--force":
            force = True; i += 1
        elif t.startswith("-"):
            i += 1
        else:
            url = t; i += 1
    if not url:
        print(__doc__); sys.exit(1)

    real = resolve_short(url)
    if real != url:
        print(f"[*] 短链已解析：{real[:90]}...")

    print("[*] 抓取页面...")
    note = parse_note(fetch_html(real), real, max_comments)

    imgs = [m for m in note["media"] if m.get("kind") == "image"]
    vids = [m for m in note["media"] if m.get("kind") == "video"]
    print(f"[✓] 作者：{note['author']}  |  标题：{note['title'][:40]}")
    print(f"[*] 数据：赞 {note['stats'].get('likedCount','?')} / "
          f"藏 {note['stats'].get('collectedCount','?')} / "
          f"评 {note['stats'].get('commentCount','?')}")
    print(f"[*] 媒体 {len(note['media'])} 项（图 {len(imgs)} / 视频 {len(vids)}）")
    if vids:
        v = vids[0]
        print(f"    视频 {v.get('width','?')}x{v.get('height','?')}"
              + (f" {int(v['durationMs'])//1000}s" if v.get("durationMs") else ""))
    print(f"[*] 话题：{'、'.join(note['tags'][:6]) or '无'}")
    print(f"[*] 评论：{len(note['comments'])} 条（上限 {max_comments}）")

    if probe:
        print("\n===PROBE===")
        print(json.dumps(note, ensure_ascii=False, indent=2))
        print("===END===")
        return

    dirname = f"小红书_{sanitize(note['author'],AUTHOR_MAX)}_{sanitize(note['title'],TITLE_MAX)}"
    target = os.path.join(out, dirname)
    n = 2
    while os.path.exists(target):
        target = os.path.join(out, f"{dirname}_{n}"); n += 1
    os.makedirs(target, exist_ok=True)
    print(f"\n[*] 落盘目录：{target}")

    if not no_media:
        for idx, item in enumerate(note["media"], 1):
            dest = os.path.join(target, media_filename(item, idx))
            try:
                sz = dl(item["url"], dest)
                item["file"] = os.path.basename(dest)
                item["size"] = sz
                unit = f"{sz/1024/1024:.1f} MB" if sz > 1024 * 1024 else f"{sz/1024:.0f} KB"
                print(f"    [{item['kind']}] {os.path.basename(dest)}  {unit}")
            except Exception as e:
                item["error"] = str(e)[:120]
                print(f"    [!] 第 {idx} 项失败：{str(e)[:80]}")

    with open(os.path.join(target, "desc.txt"), "w", encoding="utf-8") as f:
        f.write(note["desc"])
    with open(os.path.join(target, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(note, f, ensure_ascii=False, indent=2)

    # ── 来源留档（强制）──
    uid = note.get("userId") or ""
    nid = note.get("noteId") or ""
    lines = [
        "【来源 —— 你给的链接】",
        f"原始链接: {url}",
    ]
    if real != url:
        lines.append(f"展开后链接: {real[:200]}")
    lines += [
        f"下载时间: {time.strftime('%Y-%m-%d %H:%M')}",
        "类型: 小红书单篇笔记",
        "",
        "【找账号 / 找视频 —— 用这两个，永不过期】",
        f"作者: {note.get('author') or ''}",
    ]
    if uid:
        lines.append(f"作者主页: https://www.xiaohongshu.com/user/profile/{uid}")
    if nid:
        lines += [f"笔记ID: {nid}",
                  f"笔记链接: https://www.xiaohongshu.com/explore/{nid}"]
    lines += [
        "",
        "【展开后的链接（带 xsec_token，会过期，仅供对照）】",
        real,
        "",
        "【内容】",
        f"标题: {note.get('title') or ''}",
        f"图 {len(imgs)} / 视频 {len(vids)} / 正文 {len(note['desc'])} 字 / 评论 {len(note['comments'])} 条",
        f"落盘: {target}",
        "",
        "备注: 小红书号(redId) 在笔记页抓不到（字段恒空），要的话进作者主页看。",
    ]
    with open(os.path.join(target, "来源.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    # ── 完整性自检（强制）──
    ok, issues = verify_complete(target, note)
    if ok:
        print(f"\n[✓] 完整性自检通过：图 {len(imgs)} / 视频 {len(vids)} / "
              f"正文 {len(note['desc'])} 字 / 评论 {len(note['comments'])} 条")
    else:
        print("\n[!] 完整性自检 **未通过**：")
        for w in issues:
            print(f"    - {w}")

    print(f"\n{'[✓] 完成' if ok else '[✗] 未完成（完整性自检未通过）'}：{target}")
    print("\n===RESULT===")
    print(json.dumps({"engine": "xhs_note", "type": note["type"],
                      "dir": target, "title": note["title"],
                      "author": note["author"],
                      "redId": note.get("redId", ""),
                      "media": len(note["media"]),
                      "images": len(imgs), "videos": len(vids),
                      "comments": len(note["comments"])},
                     ensure_ascii=False, indent=2))
    print("===END===")
    if not ok:
        sys.exit(2)  # 自检未通过：非零退出，让上层标记失败而非假完成


if __name__ == "__main__":
    main()