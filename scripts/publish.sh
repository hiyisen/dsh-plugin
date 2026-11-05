#!/usr/bin/env bash
# 发版脚本：在插件版本 commit 之后运行，把 market/index.json 指向该 commit 并推送。
# 用法: ./scripts/publish.sh          （发布当前 dsh-downloader 版本）
set -euo pipefail
cd "$(dirname "$0")/.."

VER=$(python3 -c "import json;print(json.load(open('dsh-downloader/package.json'))['version'])")
COMMIT=$(git rev-parse HEAD)
TS=$(git log -1 --format=%ct)
EXISTING=$(python3 -c "import json;print(','.join(v['version'] for v in json.load(open('market/index.json'))['plugins'][0]['versions']))")

if [[ ",$EXISTING," == *",$VER,"* ]]; then
  echo "market/index.json 已包含 v$VER，无需更新"; exit 0
fi

python3 - "$VER" "$COMMIT" "$TS" <<'EOF'
import json, sys
ver, commit, ts = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = 'market/index.json'
idx = json.load(open(p, encoding='utf-8'))
plug = idx['plugins'][0]
plug['versions'].append({
    'version': ver,
    'publishTimestamp': ts,
    'source': {'type': 'git', 'url': 'https://github.com/hiyisen/dsh-plugin',
               'commit': commit, 'path': 'dsh-downloader'},
})
plug['versions'].sort(key=lambda v: [int(x) for x in v['version'].split('.')], reverse=True)
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
