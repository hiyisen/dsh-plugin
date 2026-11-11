#!/usr/bin/env bash
# 发版脚本：在插件版本 commit 之后运行，把 market/index.json 指向该 commit 并推送。
# 用法: ./scripts/publish.sh                 （发布 dsh-downloader，行为与原来完全一致）
#       ./scripts/publish.sh dsh-turn-summary （发布指定插件）
#       ./scripts/publish.sh ../dsh-turn-summary --repo-url https://github.com/hiyisen/dsh-turn-summary --source-path "" --source-commit <插件仓库 commit>
set -euo pipefail
cd "$(dirname "$0")/.."

PLUGIN_DIR="${1:-dsh-downloader}"
if [[ $# -gt 0 ]]; then shift; fi
REPO_URL="https://github.com/hiyisen/dsh-plugin"
SOURCE_PATH="$PLUGIN_DIR"
SOURCE_COMMIT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url) REPO_URL="${2:-}"; shift 2 ;;
    --source-path) SOURCE_PATH="${2:-}"; shift 2 ;;
    --source-commit) SOURCE_COMMIT="${2:-}"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done
PLUGIN_JSON="$PLUGIN_DIR/package.json"
[[ -f "$PLUGIN_JSON" ]] || { echo "找不到 $PLUGIN_JSON"; exit 1; }

VER=$(python3 -c "import json;print(json.load(open('$PLUGIN_JSON'))['version'])")
PKG_NAME=$(python3 -c "import json;print(json.load(open('$PLUGIN_JSON'))['name'])")
COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD)}"
TS=$(git log -1 --format=%ct)
EXISTING=$(python3 -c "
import json
idx = json.load(open('market/index.json'))
plug = next((p for p in idx['plugins'] if p['name'] == '$PKG_NAME'), None)
if plug is None:
    raise SystemExit('market/index.json 里没有插件 $PKG_NAME；先运行 scripts/market-add.sh $PLUGIN_DIR')
print(','.join(v['version'] for v in plug['versions']))")

if [[ ",$EXISTING," == *",$VER,"* ]]; then
  echo "market/index.json 已包含 v$VER，无需更新"; exit 0
fi

python3 - "$VER" "$COMMIT" "$TS" "$PKG_NAME" "$REPO_URL" "$SOURCE_PATH" <<'EOF'
import json, sys
ver, commit, ts, plugin_name, repo_url, source_path = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6]


def version_key(version):
    """Sort key that also sorts prerelease versions such as 1.0.0-rc.1.

    A plain release outranks any prerelease of the same release tuple; numeric
    prerelease identifiers compare numerically and sort below alphanumeric ones.
    Pure numeric versions such as 0.3.3 keep their previous relative order.
    """
    head, separator, tail = str(version).strip().partition('-')
    release = []
    for part in head.split('.'):
        release.append(int(part) if part.isdigit() else 0)
    while len(release) < 4:
        release.append(0)
    release = tuple(release[:4])
    if not separator or not tail:
        return (release, 1, ())
    identifiers = []
    for part in tail.split('.'):
        if part.isdigit():
            identifiers.append((0, int(part), ''))
        else:
            identifiers.append((1, 0, part))
    while len(identifiers) < 4:
        identifiers.append((-1, 0, ''))
    return (release, 0, tuple(identifiers[:4]))


p = 'market/index.json'
idx = json.load(open(p, encoding='utf-8'))
plug = next(p for p in idx['plugins'] if p['name'] == plugin_name)
source = {'type': 'git', 'url': repo_url, 'commit': commit}
if source_path:
    source['path'] = source_path
plug['versions'].append({
    'version': ver,
    'publishTimestamp': ts,
    'source': source,
})
plug['versions'].sort(key=version_key, reverse=True)
json.dump(idx, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(p, 'a').write('\n')
print(f'index.json += v{ver} @ {commit[:8]}')
EOF

git add market/index.json
git commit -m "chore(market): 索引追加 v$VER"
git -c core.sshCommand="ssh -o BatchMode=yes" push github main
echo "已推送。市场索引 URL（设置→插件市场添加；优先 jsdelivr，raw 域名国内网络不稳定）:"
echo "  https://cdn.jsdelivr.net/gh/hiyisen/dsh-plugin@main/market/index.json"
echo "  （备选）https://raw.githubusercontent.com/hiyisen/dsh-plugin/main/market/index.json"
echo "注意: jsdelivr 对 @main 有缓存，push 后如未生效等几分钟或改用 ?t= 时间戳强刷。"
