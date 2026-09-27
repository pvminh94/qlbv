#!/usr/bin/env bash
# =============================================================================
#  Dựng lại MÔI TRƯỜNG DEV/TEST của QLBS trong sandbox (Arena/E2B) sau khi bị reset.
#  An toàn khi chạy nhiều lần — bước nào đã có thì bỏ qua.
#
#    bash .ai/dev-setup.sh            # cài gói + PG + Redis + DB + npm ci + build
#    bash .ai/dev-setup.sh --demo     # (sau khi API chạy) nạp dữ liệu demo
#    bash .ai/dev-setup.sh --clean    # dọn rác để workspace nhỏ gọn (< 20MB)
#
#  Sau khi chạy xong, khởi động bằng công cụ start_process (KHÔNG chạy nền trong bash):
#    API : cd /home/user/qlbv/backend && node dist/main.js > /tmp/api.log 2>&1
#    Web : cd /home/user/qlbv/frontend && npx next start -H 0.0.0.0 -p 3000 > /tmp/fe.log 2>&1
#  Đăng nhập: admin / Admin@123
# =============================================================================
set -uo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DBURL="postgresql://postgres:postgres@127.0.0.1:5432/qlbs"
STORAGE=/tmp/qlbs-storage
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }

if [[ "${1:-}" == "--clean" ]]; then
  say "Dọn rác workspace"
  rm -rf "$REPO/.data/pgdata" "$REPO/backend/.data/backups" "$REPO/data" 2>/dev/null
  find /home/user/qlbv-debug -name '*.png' -delete 2>/dev/null
  find /home/user/qlbv-debug -name '*.pdf' -delete 2>/dev/null
  rm -f /home/user/dump.rdb
  du -sh --exclude=node_modules --exclude=.next --exclude=dist /home/user 2>/dev/null
  exit 0
fi

if [[ "${1:-}" == "--demo" ]]; then
  cd "$REPO/backend" && DATABASE_URL=$DBURL npm run db:demo 2>&1 | tail -5
  exit 0
fi

say "Gói hệ thống (postgresql, redis, poppler, cabextract)"
NEED=()
command -v pg_isready >/dev/null || NEED+=(postgresql)
command -v redis-cli >/dev/null || NEED+=(redis-server)
command -v pdftoppm >/dev/null || NEED+=(poppler-utils)
command -v cabextract >/dev/null || NEED+=(cabextract)
if ((${#NEED[@]})); then
  sudo apt-get update -qq >/dev/null 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${NEED[@]}" >/dev/null 2>&1 && ok "Đã cài ${NEED[*]}"
else ok "Đã có đủ"; fi

say "PostgreSQL + Redis"
sudo service postgresql start >/dev/null 2>&1
sudo service redis-server start >/dev/null 2>&1
sleep 2
pg_isready -q && ok "PostgreSQL chạy" || echo "  ✗ PostgreSQL chưa chạy"
redis-cli ping >/dev/null 2>&1 && ok "Redis chạy" || echo "  ✗ Redis chưa chạy"
sudo -u postgres psql -qc "alter user postgres password 'postgres'" >/dev/null 2>&1
NEWDB=0
if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='qlbs'" | grep -q 1; then
  sudo -u postgres createdb qlbs && NEWDB=1 && ok "Tạo DB qlbs"
fi

say "backend/.env trỏ tới PG thật + storage /tmp"
ENVF="$REPO/backend/.env"
[[ -f "$ENVF" ]] || cp "$REPO/backend/.env.example" "$ENVF"
sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$DBURL#; s#^STORAGE_DIR=.*#STORAGE_DIR=$STORAGE#" "$ENVF"
grep -q '^STORAGE_DIR=' "$ENVF" || echo "STORAGE_DIR=$STORAGE" >>"$ENVF"
ok "DATABASE_URL, STORAGE_DIR đã đặt"

say "Font Times New Roman gốc cho renderer (dev: $STORAGE/fonts)"
mkdir -p "$STORAGE/fonts"
if ! ls "$STORAGE/fonts" | grep -qi 'times'; then
  T=$(mktemp -d)
  if curl -fsSL --retry 3 -o "$T/times32.exe" https://downloads.sourceforge.net/corefonts/times32.exe &&
    cabextract -q -d "$T" "$T/times32.exe" >/dev/null 2>&1; then
    for v in "Times.TTF:regular" "Timesbd.TTF:bold" "Timesi.TTF:italic" "Timesbi.TTF:boldItalic"; do
      f=$(find "$T" -iname "${v%%:*}" | head -1)
      [[ -n "$f" ]] && cp "$f" "$STORAGE/fonts/Times-New-Roman-${v##*:}.ttf"
    done
    ok "Đã cài TNR"
  else echo "  ! Không tải được TNR — renderer dùng Tinos (tương thích)"; fi
  rm -rf "$T"
else ok "Đã có"; fi

say "npm ci (backend, frontend) — chỉ khi thiếu node_modules"
for d in backend frontend; do
  if [[ ! -d "$REPO/$d/node_modules/.bin" ]]; then
    (cd "$REPO/$d" && npm ci --no-audit --no-fund >/tmp/npm-$d.log 2>&1) && ok "$d: npm ci xong" || echo "  ✗ $d: xem /tmp/npm-$d.log"
  else ok "$d: đã có node_modules"; fi
done

say "Build backend (nest build) + migrate/seed"
(cd "$REPO/backend" && npx nest build >/tmp/be-build.log 2>&1) && ok "nest build" || echo "  ✗ xem /tmp/be-build.log"
(cd "$REPO/backend" && DATABASE_URL=$DBURL npm run db:migrate >/tmp/migrate.log 2>&1) && ok "migrate" || echo "  ✗ xem /tmp/migrate.log"
if ((NEWDB)); then
  (cd "$REPO/backend" && DATABASE_URL=$DBURL npm run db:seed >/tmp/seed.log 2>&1) && ok "seed (admin / Admin@123)"
  echo "  → Khởi động API rồi chạy: bash .ai/dev-setup.sh --demo  (nạp dữ liệu demo)"
fi

say "Build frontend (next build)"
(cd "$REPO/frontend" && npx next build >/tmp/fe-build.log 2>&1) && ok "next build" || echo "  ✗ xem /tmp/fe-build.log"

say "Playwright (test giao diện) tại /tmp/pw"
if [[ ! -d /tmp/pw/node_modules/playwright ]]; then
  mkdir -p /tmp/pw && (cd /tmp/pw && npm init -y >/dev/null 2>&1 && npm i playwright >/dev/null 2>&1)
fi
(cd /tmp/pw && npx playwright install chromium >/dev/null 2>&1 && sudo npx playwright install-deps chromium >/dev/null 2>&1) && ok "chromium sẵn sàng"

say "XONG. Khởi động API/Web bằng start_process (xem đầu tệp)."
