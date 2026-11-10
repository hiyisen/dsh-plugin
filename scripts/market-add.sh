#!/usr/bin/env bash
# 首次入库：把一个插件加进 market/index.json（建分类 + 建条目 + 追加首个版本）并提交（**不 push**）。
#
# 用法: ./scripts/market-add.sh <插件目录> <中文标题> <英文标题> <分类键> [选项]
#   --en-description "..."      英文描述（缺省用通用英文模板）
#   --zh-description "..."      中文描述（缺省取插件 package.json 的 description）
#   --category-title-en "..."   分类英文标题（缺省用内置表）
#   --category-title-zh "..."   分类中文标题（缺省用内置表）
#   --keywords "a,b,c"          关键词，逗号分隔（缺省用插件名派生）
#   --refresh-commit            把既有条目的 source.commit 刷新到当前 HEAD
#   --update-description        用 --zh-description / --en-description 的完整文本
#                               改写既有条目的描述（不带此参数时不碰既有描述）
#   --no-commit                 只改文件，不提交
#
# 幂等：重复执行不会产生重复条目，也不会产生重复版本。
# 增量：既有条目与既有分类一个字节都不动——写入走文本级插入，不整体重排 JSON。
#
# --refresh-commit 是显式开关：只有带上它才会改写既有条目的 source.commit；
# 不带这个参数时脚本行为与之前完全一致（同样幂等、同样不碰既有条目的字节）。
# --update-description 同理：只有带上它才会改写既有条目的描述文本。
#
# 重建示例（dsh-turn-summary 的条目就是用这条命令生成的，可原样重跑）：
#   scripts/market-add.sh dsh-turn-summary "本轮摘要" "Turn Summary" observability \
#     --zh-description "每轮回复末尾固定一行摘要：……本版本与已装机的 0.2.2-rc.1 产物一致，升级不会改变显示效果。" \
#     --en-description "A fixed one-line summary under every completed reply: …… Same artifact as 0.2.2-rc.1 already installed locally; upgrading does not change what the line shows."
#
# 与 publish.sh 的分工（**有意不同，不是疏漏，勿"顺手统一"**）：
#   · publish.sh  是既有脚本的泛化，硬指标是「对 dsh-downloader 无参执行与改造前逐行等价」，
#     因此它保留原有的 json.dump 整体重排写法——重排是它的既有行为。
#   · market-add.sh 是新脚本，硬指标是「既有条目与既有分类一个字节都不动」，
#     因此它走文本级插入，只在末尾追加新成员。
#   两者服务不同目标、各自正确：谁最后写索引，谁决定文件的排版风格。
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "用法: scripts/market-add.sh <插件目录> <中文标题> <英文标题> <分类键> [--en-description \"...\"] [--zh-description \"...\"] [--category-title-en \"...\"] [--category-title-zh \"...\"] [--keywords \"a,b,c\"] [--refresh-commit] [--update-description] [--no-commit]" >&2
  exit 1
}

[[ $# -ge 4 ]] || usage
DIR="$1"; ZH_TITLE="$2"; EN_TITLE="$3"; CATEGORY="$4"; shift 4

EN_DESCRIPTION=""
ZH_DESCRIPTION=""
CATEGORY_TITLE_EN=""
CATEGORY_TITLE_ZH=""
KEYWORDS=""
REFRESH_COMMIT=0
UPDATE_DESCRIPTION=0
DO_COMMIT=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --en-description) EN_DESCRIPTION="${2:-}"; shift 2 ;;
    --zh-description) ZH_DESCRIPTION="${2:-}"; shift 2 ;;
    --category-title-en) CATEGORY_TITLE_EN="${2:-}"; shift 2 ;;
    --category-title-zh) CATEGORY_TITLE_ZH="${2:-}"; shift 2 ;;
    --keywords) KEYWORDS="${2:-}"; shift 2 ;;
    --refresh-commit) REFRESH_COMMIT=1; shift ;;
    --update-description) UPDATE_DESCRIPTION=1; shift ;;
    --no-commit) DO_COMMIT=0; shift ;;
    *) echo "未知参数: $1" >&2; usage ;;
  esac
done

if [[ "$UPDATE_DESCRIPTION" == "1" && -z "$ZH_DESCRIPTION" && -z "$EN_DESCRIPTION" ]]; then
  echo "--update-description 需要配合 --zh-description / --en-description 使用" >&2
  exit 1
fi

PKG_JSON="$DIR/package.json"
[[ -f "$PKG_JSON" ]] || { echo "找不到 $PKG_JSON"; exit 1; }

PKG_NAME=$(python3 -c "import json;print(json.load(open('$PKG_JSON'))['name'])")
COMMIT=$(git rev-parse HEAD)
TS=$(git log -1 --format=%ct)

PY_OUTPUT=$(python3 - "$DIR" "$ZH_TITLE" "$EN_TITLE" "$CATEGORY" "$EN_DESCRIPTION" "$ZH_DESCRIPTION" \
  "$CATEGORY_TITLE_EN" "$CATEGORY_TITLE_ZH" "$KEYWORDS" "$COMMIT" "$TS" "$REFRESH_COMMIT" "$UPDATE_DESCRIPTION" <<'PYEOF'
import json
import os
import re
import sys

(plugin_dir, zh_title, en_title, category, en_description, zh_description,
 category_title_en, category_title_zh, keywords, commit, timestamp, refresh_commit,
 update_description) = sys.argv[1:14]
timestamp = int(timestamp)
refresh_commit = refresh_commit == '1'
update_description = update_description == '1'

INDEX = 'market/index.json'
REPO_URL = 'https://github.com/hiyisen/dsh-plugin'
DEFAULT_EN_DESCRIPTION = (
    'One fixed summary line at the end of every completed reply. Folded entirely in '
    'the browser from events the client already received — no model request, no '
    'token cost, no session-log writes.'
)
CATEGORY_TITLES = {
    'media': {'en': 'Media & download', 'zh-cn': '媒体与下载'},
    'observability': {'en': 'Observability', 'zh-cn': '可观测性'},
}


def jstr(value):
    """Render one JSON scalar the way the index file spells it."""
    return json.dumps(value, ensure_ascii=False)


def render_value(value):
    """Render one JSON value the way the index file spells it."""
    if isinstance(value, dict):
        return '{ ' + ', '.join('%s: %s' % (jstr(k), render_value(v)) for k, v in value.items()) + ' }'
    if isinstance(value, list):
        return '[' + ', '.join(render_value(item) for item in value) + ']'
    return jstr(value)


def render_inline(obj):
    """Render a flat object on a single line: { "k": v, "k2": v2 }."""
    return render_value(obj)


def find_value_start(text, key):
    """Index of the JSON value that follows the given key."""
    match = re.search(r'"%s"\s*:' % re.escape(key), text)
    if match is None:
        raise SystemExit('market/index.json 里找不到键 "%s"' % key)
    index = match.end()
    while index < len(text) and text[index] in ' \t\r\n':
        index += 1
    return index


def find_block_end(text, start):
    """Index of the closer matching the opener at `start` (string aware)."""
    opener = text[start]
    closer = {'{': '}', '[': ']'}[opener]
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return index
    raise SystemExit('market/index.json 结构异常：括号不配对')


def line_indent(text, position):
    """Leading whitespace of the line that holds `position`."""
    line_start = text.rfind('\n', 0, position) + 1
    prefix = text[line_start:position]
    return prefix if prefix.strip() == '' else ''


def split_elements(text, open_index, close_index):
    """Spans of the top-level elements inside a JSON array."""
    spans = []
    depth = 0
    in_string = False
    escape = False
    start = None
    for index in range(open_index + 1, close_index):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            if start is None:
                start = index
            continue
        if start is None:
            if char.isspace():
                continue
            start = index
        if char in '{[':
            depth += 1
            continue
        if char in '}]':
            depth -= 1
            continue
        if char == ',' and depth == 0:
            spans.append((start, index))
            start = None
    if start is not None:
        spans.append((start, close_index))
    return spans


def element_indent(text, open_index, close_index):
    """Indentation of the array elements (or object members) of a block."""
    inner_start = open_index + 1
    while inner_start < close_index and text[inner_start] in ' \t\r\n':
        inner_start += 1
    if inner_start < close_index:
        line_start = text.rfind('\n', 0, inner_start) + 1
        prefix = text[line_start:inner_start]
        if prefix.strip() == '':
            return len(prefix)
    return len(line_indent(text, open_index)) + 2


def insert_into_block(text, open_index, close_index, lines, eol):
    """Append one element/member at the end of a JSON array/object, keeping the rest byte-identical."""
    closing_indent = line_indent(text, close_index)
    block = eol.join(lines)
    inner = text[open_index + 1:close_index]
    if inner.strip() == '':
        return (text[:open_index + 1] + eol + block + eol + closing_indent + text[close_index:])
    cut = close_index
    while cut > 0 and text[cut - 1] in ' \t\r\n':
        cut -= 1
    return text[:cut] + ',' + eol + block + eol + closing_indent + text[close_index:]


def render_category_lines(category_key, title, indent):
    """One category member: "key": { "title": { "en": ..., "zh-cn": ... } }."""
    return ['%s%s: %s' % (' ' * indent, jstr(category_key), render_inline({'title': title}))]


def render_version_lines(version, indent):
    pad = ' ' * indent
    inner = ' ' * (indent + 2)
    source = version['source']
    return [
        pad + '{',
        '%s%s: %s,' % (inner, jstr('version'), jstr(version['version'])),
        '%s%s: %s,' % (inner, jstr('publishTimestamp'), version['publishTimestamp']),
        '%s%s: {' % (inner, jstr('source')),
        '%s  %s: %s,' % (inner, jstr('type'), jstr(source['type'])),
        '%s  %s: %s,' % (inner, jstr('url'), jstr(source['url'])),
        '%s  %s: %s,' % (inner, jstr('commit'), jstr(source['commit'])),
        '%s  %s: %s' % (inner, jstr('path'), jstr(source['path'])),
        '%s}' % inner,
        '%s}' % pad,
    ]


def render_plugin_lines(entry, indent):
    pad = ' ' * indent
    inner = ' ' * (indent + 2)
    description = entry['description']
    lines = [
        pad + '{',
        '%s%s: %s,' % (inner, jstr('name'), jstr(entry['name'])),
        '%s%s: %s,' % (inner, jstr('title'), render_inline(entry['title'])),
        '%s%s: {' % (inner, jstr('description')),
        '%s  %s: %s,' % (inner, jstr('en'), jstr(description['en'])),
        '%s  %s: %s' % (inner, jstr('zh-cn'), jstr(description['zh-cn'])),
        '%s},' % inner,
        '%s%s: %s,' % (inner, jstr('author'), jstr(entry['author'])),
        '%s%s: %s,' % (inner, jstr('homepage'), jstr(entry['homepage'])),
        '%s%s: %s,' % (inner, jstr('repository'), render_inline(entry['repository'])),
        '%s%s: %s,' % (inner, jstr('metadata'), render_inline(entry['metadata'])),
        '%s%s: [' % (inner, jstr('versions')),
    ]
    lines.extend(render_version_lines(entry['versions'][0], indent + 4))
    lines.append('%s]' % inner)
    lines.append('%s}' % pad)
    return lines


def refresh_source_commits(entry_text, commit):
    """Rewrite every "commit" value inside one plugin entry's versions.

    Text-level rewrite: only the commit hash changes, every other byte of the
    entry (and of the rest of the index) stays exactly as it was.
    @param entry_text - the plugin entry's source text.
    @param commit - the commit hash to write.
    @returns (text, changed) - the rewritten text and whether anything changed.
    """
    pattern = re.compile(r'("commit"\s*:\s*")([0-9a-fA-F]{7,64})(")')
    changed = False

    def replace(match):
        """Swap one commit hash, remembering whether the entry moved."""
        nonlocal changed
        if match.group(2) == commit:
            return match.group(0)
        changed = True
        return match.group(1) + commit + match.group(3)

    return pattern.sub(replace, entry_text), changed


def update_entry_descriptions(entry_text, en_description, zh_description):
    """Rewrite the description block of one plugin entry, textually.

    Only the two description strings change; every other byte of the entry
    (and of the rest of the index) stays exactly as it was.
    @param entry_text - the plugin entry's source text.
    @param en_description - new English description; empty keeps the current one.
    @param zh_description - new Chinese description; empty keeps the current one.
    @returns (text, changed) - the rewritten text and whether anything changed.
    """
    desc_open = find_value_start(entry_text, 'description')
    desc_close = find_block_end(entry_text, desc_open)
    block = entry_text[desc_open:desc_close + 1]
    updated = block
    if en_description:
        updated = re.sub(
            r'("en"\s*:\s*)("(?:[^"\\]|\\.)*")',
            lambda match: match.group(1) + jstr(en_description),
            updated,
            count=1,
        )
    if zh_description:
        updated = re.sub(
            r'("zh-cn"\s*:\s*)("(?:[^"\\]|\\.)*")',
            lambda match: match.group(1) + jstr(zh_description),
            updated,
            count=1,
        )
    return entry_text[:desc_open] + updated + entry_text[desc_close + 1:], updated != block


with open(INDEX, encoding='utf-8', newline='') as handle:
    text = handle.read()
eol = '\r\n' if '\r\n' in text else '\n'
data = json.loads(text)

with open(os.path.join(plugin_dir, 'package.json'), encoding='utf-8') as handle:
    package = json.load(handle)
name = package['name']
version = package['version']
author = package.get('author', 'hiyisen')
resolved_zh = zh_description or package.get('description', '')
resolved_en = en_description or DEFAULT_EN_DESCRIPTION
resolved_keywords = (
    [part.strip() for part in keywords.split(',') if part.strip()]
    if keywords else [name]
)
category_title = {
    'en': category_title_en or CATEGORY_TITLES.get(category, {}).get('en', category),
    'zh-cn': category_title_zh or CATEGORY_TITLES.get(category, {}).get('zh-cn', category),
}

# 1) 分类：缺了才建，既有分类一个字节都不动。
if category not in data['metadata']['categories']:
    category_open = find_value_start(text, 'categories')
    category_close = find_block_end(text, category_open)
    indent = element_indent(text, category_open, category_close)
    lines = render_category_lines(category, category_title, indent)
    text = insert_into_block(text, category_open, category_close, lines, eol)
    print('分类 %s 已创建' % category)
else:
    print('分类 %s 已存在' % category)

# 2) 插件条目 + 3) 版本：缺了才建，既有条目与版本一个字节都不动。
plugin_open = find_value_start(text, 'plugins')
plugin_close = find_block_end(text, plugin_open)
existing = None
for start, end in split_elements(text, plugin_open, plugin_close):
    try:
        item = json.loads(text[start:end])
    except ValueError:
        continue
    if isinstance(item, dict) and item.get('name') == name:
        existing = (start, end, item)
        break

if existing is None:
    entry = {
        'name': name,
        'title': {'en': en_title, 'zh-cn': zh_title},
        'description': {'en': resolved_en, 'zh-cn': resolved_zh},
        'author': author,
        'homepage': REPO_URL,
        'repository': {'url': REPO_URL, 'directory': plugin_dir},
        'metadata': {'category': category, 'keywords': resolved_keywords},
        'versions': [{
            'version': version,
            'publishTimestamp': timestamp,
            'source': {'type': 'git', 'url': REPO_URL, 'commit': commit, 'path': plugin_dir},
        }],
    }
    indent = element_indent(text, plugin_open, plugin_close)
    lines = render_plugin_lines(entry, indent)
    text = insert_into_block(text, plugin_open, plugin_close, lines, eol)
    print('插件条目 %s 已创建（v%s @ %s）' % (name, version, commit[:8]))
    action = 'created'
else:
    start, end, item = existing
    moved = False
    appended = False
    described = False
    if refresh_commit:
        entry_text = text[start:end]
        entry_text, moved = refresh_source_commits(entry_text, commit)
        if moved:
            text = text[:start] + entry_text + text[end:]
            end = start + len(entry_text)
            item = json.loads(text[start:end])
            print('插件条目 %s 的 source.commit 已刷新到 %s' % (name, commit[:8]))
        else:
            print('插件条目 %s 的 source.commit 已是 %s —— 无需刷新' % (name, commit[:8]))
    if update_description:
        entry_text = text[start:end]
        entry_text, described = update_entry_descriptions(
            entry_text, en_description, zh_description)
        if described:
            text = text[:start] + entry_text + text[end:]
            end = start + len(entry_text)
            item = json.loads(text[start:end])
            print('插件条目 %s 的描述已更新' % name)
        else:
            print('插件条目 %s 的描述已是给定文本 —— 无需更新' % name)
    if any(entry['version'] == version for entry in item['versions']):
        print('插件条目 %s 已存在，且已含 v%s —— 无需更新' % (name, version))
    else:
        entry_text = text[start:end]
        versions_open = find_value_start(entry_text, 'versions')
        versions_close = find_block_end(entry_text, versions_open)
        indent = element_indent(entry_text, versions_open, versions_close)
        lines = render_version_lines({
            'version': version,
            'publishTimestamp': timestamp,
            'source': {'type': 'git', 'url': REPO_URL, 'commit': commit, 'path': plugin_dir},
        }, indent)
        updated = insert_into_block(entry_text, versions_open, versions_close, lines, eol)
        text = text[:start] + updated + text[end:]
        end = start + len(updated)
        appended = True
        print('插件条目 %s 已存在，追加 v%s' % (name, version))
    if described:
        action = 'updated' if (moved or appended) else 'described'
    elif moved:
        action = 'updated' if appended else 'refreshed'
    elif appended:
        action = 'updated'
    else:
        action = 'unchanged'

check = json.loads(text)
names = [plugin['name'] for plugin in check['plugins']]
assert names.count(name) == 1, '插件条目重复：%s' % names
assert category in check['metadata']['categories'], '分类缺失：%s' % category
versions = [plugin['versions'] for plugin in check['plugins'] if plugin['name'] == name][0]
assert len([v for v in versions if v['version'] == version]) == 1, '版本重复'

with open(INDEX, 'w', encoding='utf-8', newline='') as handle:
    handle.write(text)

print('校验通过：categories=%s plugins=%s' % (list(check['metadata']['categories']), names))
print('ACTION=%s' % action)
PYEOF
)

echo "$PY_OUTPUT"
ACTION=$(printf '%s\n' "$PY_OUTPUT" | sed -n 's/^ACTION=//p' | tail -n 1)

if git diff --quiet -- market/index.json; then
  echo "market/index.json 无变化（无需提交）"
  exit 0
fi

git add market/index.json
echo "--- market/index.json 待提交变更 ---"
git diff --cached -- market/index.json

case "$ACTION" in
  created) COMMIT_MESSAGE="feat(market): 新增插件条目 $PKG_NAME" ;;
  refreshed) COMMIT_MESSAGE="chore(market): 刷新插件条目 $PKG_NAME 的 source.commit" ;;
  described) COMMIT_MESSAGE="chore(market): 更新插件条目 $PKG_NAME 的描述" ;;
  *) COMMIT_MESSAGE="chore(market): 更新插件条目 $PKG_NAME" ;;
esac

if [[ "$DO_COMMIT" == "1" ]]; then
  git commit -m "$COMMIT_MESSAGE"
  echo "已提交（未 push）。请复核上面的 diff。"
else
  git reset -q -- market/index.json
  echo "已写入工作区（--no-commit，未提交、未 push）。"
fi
