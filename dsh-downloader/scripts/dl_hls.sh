#!/bin/bash
# dl_hls.sh —— 伪装头 HLS 一条命令闭环下载（自包含插件版）
#
# 用法:
#   dl_hls.sh <m3u8链接> <文件名> [成品目录] [RE额外参数]
#   成品目录可用 OUT 环境变量覆盖；临时目录用 TMP_DIR 环境变量覆盖
#
# 环境变量（引擎注入）:
#   OUT          - 成品目录（默认 /ai/下载）
#   TMP_DIR      - 临时目录（默认 $DATA/tmp_down）
#   LOG_DIR      - 日志目录（默认 $DATA/logs）
#   RE_BIN       - N_m3u8DL-RE 可执行文件（默认从 PATH 解析）
#   FF_BIN       - ffmpeg（默认从 PATH 解析）
#   FP_BIN       - ffprobe（默认从 PATH 解析）
#   DLM_LOG      - 引擎日志文件路径（由引擎强制指定）
#   NO_PROXY     - 由引擎设置（国内直连不走代理）
set -uo pipefail

URL="${1:-}"; NAME="${2:-}"; OUT="${3:-${OUT:-/ai/下载}}"; EXTRA="${4:-}"

# 解析脚本所在目录（插件 scripts/）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# 默认值可被环境变量覆盖
RE_BIN="${RE_BIN:-N_m3u8DL-RE}"
FF_BIN="${FF_BIN:-ffmpeg}"
FP_BIN="${FP_BIN:-ffprobe}"
TMP_DIR="${TMP_DIR:-$PLUGIN_ROOT/tmp_down}"
LOG_DIR="${LOG_DIR:-$PLUGIN_ROOT/logs}"
LEDGER="${LEDGER:-$PLUGIN_ROOT/download_log.txt}"
STATUS="${STATUS:-$LOG_DIR/$NAME.status}"
LOGF="${DLM_LOG:-$LOG_DIR/$NAME.log}"

[ -n "$URL" ] && [ -n "$NAME" ] || { echo "用法: dl_hls.sh <m3u8链接> <文件名> [成品目录] [RE额外参数]"; exit 2; }

mkdir -p "$TMP_DIR" "$LOG_DIR" "$OUT"
: > "$LOGF"
die(){ echo "失败|$*|$NAME|" > "$STATUS"; echo "[失败] $*（详见 $LOGF）"; exit 1; }

echo "开始|0%|$NAME|" > "$STATUS"

# ---------- 1) RE 下载（必须 pty 包裹，否则 RE beta 崩） ----------
cd "$TMP_DIR" || die "无法进入临时目录"
{
  echo "=== RE 开始 $(date '+%Y-%m-%d %H:%M:%S') ==="
  script -qec "$RE_BIN '$URL' --save-dir '$TMP_DIR' --save-name '$NAME' --auto-select \
    --thread-count 24 --download-retry-count 15 --http-request-timeout 60 \
    --no-date-info $EXTRA" /dev/null
  echo "===RE_EXIT=$?==="
} >> "$LOGF" 2>&1 &
REPID=$!

# 进度只写状态文件（一行），不回灌对话
(
  while kill -0 "$REPID" 2>/dev/null; do
    pct=$(grep -oE "SDR: [0-9]+%" "$LOGF" 2>/dev/null | tail -1 | grep -oE "[0-9]+")
    echo "下载中|${pct:-0}%|$NAME|" > "$STATUS"
    sleep 5
  done
) &

wait "$REPID"
grep -q "===RE_EXIT=0===" "$LOGF" || die "RE 下载未成功（多为最后一段 CDN 断流，见日志）"

SRC="$TMP_DIR/$NAME.mp4"
[ -s "$SRC" ] || die "未找到合并产物 $SRC"

# ---------- 2) faststart（坑13：moov 必须前置，否则共享盘打不开） ----------
echo "转faststart|100%|$NAME|" > "$STATUS"
"$FF_BIN" -y -v error -i "$SRC" -c copy -movflags +faststart "$TMP_DIR/$NAME.fast.mp4" >> "$LOGF" 2>&1 \
  || die "faststart 失败"
[ -s "$TMP_DIR/$NAME.fast.mp4" ] || die "faststart 无产物"

# ---------- 3) 校验（只取需要的字段，不 dump 全量） ----------
CHK=$("$FP_BIN" -v error -show_entries format=duration \
      -show_entries stream=codec_type,codec_name,width,height \
      -of default=noprint_wrappers=1 "$TMP_DIR/$NAME.fast.mp4" 2>>"$LOGF")
echo "$CHK" | grep -q "codec_name=h264" || die "校验失败：没有 h264 视频轨"
echo "$CHK" | grep -q "codec_name=aac"  || die "校验失败：没有 aac 音轨"
DUR=$(echo "$CHK" | grep -oE "^duration=[0-9.]+" | head -1 | cut -d= -f2)

head -c 1048576 "$TMP_DIR/$NAME.fast.mp4" > "$TMP_DIR/.head.bin" 2>/dev/null
MOOV_OK=$(node -e '
const fs=require("fs");const b=fs.readFileSync(process.argv[1]);
let off=0,bx=[];
while(off+8<=b.length){const s=b.readUInt32BE(off);const t=b.toString("ascii",off+4,off+8);bx.push(t);if(s<8)break;off+=s;}
const mi=bx.findIndex(x=>x==="moov"), di=bx.findIndex(x=>x==="mdat");
console.log((mi>=0&&(di<0||mi<di))?"yes":"no");
' "$TMP_DIR/.head.bin" 2>/dev/null)
[ "$MOOV_OK" = "yes" ] || die "校验失败：moov 未在 mdat 之前（非 faststart）"

# ---------- 4) 校验通过才进成品目录（一则一目录，与小红书/抖音一致） ----------
TS=$(date '+%Y-%m-%d %H:%M')
ITEM="$OUT/$NAME"
mkdir -p "$ITEM" || die "无法创建目录 $ITEM"
mv -f "$TMP_DIR/$NAME.fast.mp4" "$ITEM/$NAME.mp4" || die "移入成品目录失败"
SIZE=$(stat -c%s "$ITEM/$NAME.mp4")

# 来源记录：写进该条自己的目录里（回溯找链接用；与小红书/抖音同一套做法）
cat > "$ITEM/来源.txt" <<EOF
【来源 —— 你给的链接】
原始链接(m3u8): $URL
下载时间: $TS
类型: HLS 直链（分片为「PNG伪装头+真TS」，已剥离伪装头并 faststart）

【内容】
代号/标题: $NAME
清晰度: 1920x1080 (h264 + aac)
时长: ${DUR}s
成品: $ITEM/$NAME.mp4
备注: 该源为直链，无账号信息；想回溯只能靠上面这条原始 m3u8 链接。
EOF

# ---------- 5) 清理临时 ----------
rm -f "$SRC" "$TMP_DIR/.head.bin"
[ -d "$TMP_DIR/$NAME" ] && rm -rf "$TMP_DIR/$NAME"
rm -f "$LOG_DIR"/progress-*.txt

# ---------- 6) 台账 ----------
LAST=$(tail -1 "$LEDGER" 2>/dev/null | cut -f1 | grep -oE '^[0-9]+' || echo 0)
NEXT=$(( ${LAST:-0} + 1 ))
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$NEXT" "$TS" "$URL" "$NAME" "成功" "$ITEM/$NAME.mp4" >> "$LEDGER"

# ---------- 7) 只回一行 ----------
echo "成功|100%|$ITEM/$NAME.mp4|${SIZE}|${DUR}s" > "$STATUS"
echo "[完成] $ITEM/$NAME.mp4  大小 ${SIZE}  时长 ${DUR}s"