#!/usr/bin/env bash
# =============================================================================
#  Cài font Times New Roman GỐC (Microsoft) cho bản in PDF của QLBS.
#
#  Nguồn: gói "Core fonts for the Web" của Microsoft (times32.exe — Microsoft cho phép
#  phân phối lại nguyên bản tệp .exe này; đây cũng là cách gói ttf-mscorefonts-installer
#  của Debian/Ubuntu làm). Bản 2.82 có đủ chữ tiếng Việt có dấu.
#
#  Font được giải nén vào  <UPLOAD_HOST_DIR>/fonts  (mặc định ./data/uploads/fonts) —
#  nằm trong volume dữ liệu nên không mất khi cập nhật. API tự nhận font mới, không cần
#  khởi động lại. Nếu không cài được (VPS không có Internet…) hệ thống vẫn in bằng Tinos —
#  font tương thích metric với Times New Roman (bố cục giống hệt).
#
#  Dùng:  sudo bash deploy/install-times-font.sh [--force] [--quiet]
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
FORCE=0
QUIET=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --quiet) QUIET=1 ;;
  esac
done
say()  { [[ $QUIET -eq 1 ]] || printf '  %s\n' "$*"; }
fail() { printf '  ! %s\n' "$*" >&2; exit 1; }

UPLOAD_DIR=""
if [[ -f .env ]]; then
  UPLOAD_DIR=$(grep -E '^UPLOAD_HOST_DIR=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'")
fi
UPLOAD_DIR=${UPLOAD_DIR:-./data/uploads}
[[ "$UPLOAD_DIR" = /* ]] || UPLOAD_DIR="$ROOT/${UPLOAD_DIR#./}"
FONT_DIR="$UPLOAD_DIR/fonts"
mkdir -p "$FONT_DIR" || fail "Không tạo được $FONT_DIR"

NAMES=(regular bold italic boldItalic)
SRC=(times.ttf timesbd.ttf timesi.ttf timesbi.ttf)
if [[ $FORCE -eq 0 ]]; then
  have=0
  for n in "${NAMES[@]}"; do [[ -s "$FONT_DIR/Times-New-Roman-$n.ttf" ]] && have=$((have + 1)); done
  if [[ $have -eq 4 ]]; then
    say "✓ Font Times New Roman gốc đã có tại $FONT_DIR"
    exit 0
  fi
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say "→ Tải gói font Times New Roman (Microsoft Core fonts, ~650 KB)…"
URLS=(
  "https://downloads.sourceforge.net/corefonts/times32.exe"
  "https://master.dl.sourceforge.net/project/corefonts/the%20fonts/final/times32.exe"
  "https://sourceforge.net/projects/corefonts/files/the%20fonts/final/times32.exe/download"
)
okdl=0
for u in "${URLS[@]}"; do
  if curl -fsSL --retry 2 --max-time 120 -o "$TMP/times32.exe" "$u" && [[ $(stat -c %s "$TMP/times32.exe" 2>/dev/null || echo 0) -gt 500000 ]]; then
    okdl=1
    break
  fi
done
[[ $okdl -eq 1 ]] || fail "Không tải được times32.exe (VPS cần Internet). Bản in vẫn dùng Tinos — tương thích Times New Roman."

mkdir -p "$TMP/out"
if command -v cabextract >/dev/null 2>&1; then
  cabextract -q -d "$TMP/out" "$TMP/times32.exe" >/dev/null 2>&1 || fail "Giải nén times32.exe thất bại"
elif command -v docker >/dev/null 2>&1; then
  say "→ Giải nén bằng container alpine tạm (máy chủ không có cabextract)…"
  docker run --rm -v "$TMP:/w" alpine:3 sh -c 'apk add --no-cache cabextract >/dev/null && cabextract -q -d /w/out /w/times32.exe' >/dev/null 2>&1 ||
    fail "Giải nén thất bại — cài cabextract (apt-get install cabextract) rồi chạy lại"
elif command -v apt-get >/dev/null 2>&1; then
  apt-get install -y -q cabextract >/dev/null 2>&1 && cabextract -q -d "$TMP/out" "$TMP/times32.exe" >/dev/null 2>&1 ||
    fail "Không cài được cabextract"
else
  fail "Cần cabextract hoặc docker để giải nén"
fi

for i in 0 1 2 3; do
  f=$(find "$TMP/out" -maxdepth 1 -iname "${SRC[$i]}" | head -1)
  [[ -n "$f" ]] || fail "Thiếu tệp ${SRC[$i]} trong gói"
  # Xoá bản tải lên thủ công cùng kiểu (tránh trùng)
  rm -f "$FONT_DIR/Times-New-Roman-${NAMES[$i]}.otf"
  install -m 0644 "$f" "$FONT_DIR/Times-New-Roman-${NAMES[$i]}.ttf"
done
# Container API chạy bằng user node (uid 1000)
chown -R 1000:1000 "$FONT_DIR" 2>/dev/null || true
touch "$FONT_DIR"
say "✓ Đã cài Times New Roman gốc (thường, đậm, nghiêng, đậm nghiêng) vào $FONT_DIR"
