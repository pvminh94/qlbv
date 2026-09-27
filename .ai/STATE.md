# STATE.md — Bối cảnh làm việc QLBS (đọc đầu tiên khi mở phiên chat mới)

> **Cách dùng ở phiên mới:** gửi cho trợ lý câu:
> *"Clone https://github.com/pvminh94/qlbv về /home/user/qlbv, đọc `.ai/STATE.md` rồi chạy `bash .ai/dev-setup.sh` để dựng môi trường, sau đó làm tiếp: …"*
> (kèm GitHub token mới nếu cần push). Nếu workspace cũ còn, chỉ cần: *"Đọc /home/user/qlbv/.ai/STATE.md"*.
>
> **Trợ lý phải cập nhật tệp này** (mục 4, 5, 6) sau mỗi yêu cầu hoàn thành và commit cùng code.

---

## 1. Quy tắc bắt buộc (người dùng đã chỉ định)

1. **Trả lời bằng tiếng Việt.**
2. **Push thẳng lên `main`** của `github.com/pvminh94/qlbv` (người dùng đồng ý "cách A").
3. **GitHub token (PAT)**: người dùng gửi trong chat. **Không ghi token vào tệp nào, không để trong `git remote`.**
   Push bằng: `git push "https://x-access-token:<PAT>@github.com/pvminh94/qlbv.git" HEAD:main 2>&1 | sed 's/ghp_[A-Za-z0-9]*/***/g'`.
   Không có token → xin lại. Nhắc người dùng thu hồi token sau khi dùng.
4. **Mỗi khi báo cáo xong việc phải kèm lệnh cập nhật VPS**:
   `cd /opt/qlbs && sudo bash deploy/update.sh --backup`
   (update.sh tự `git pull`, tự chạy lại bằng bản mới nếu chính nó đổi, tự cài font TNR — **không** hướng dẫn `git pull` riêng).
5. Git identity trong repo: `git config user.name "QLBS Bot"; git config user.email bot@qlbs.local` (mất sau reset vì `.git/config` không được lưu).
6. Giữ bit thực thi: `chmod +x deploy/*.sh && git update-index --chmod=+x deploy/*.sh` trước khi commit.

## 2. Dự án

- **QLBS — Phần mềm quản lý bệnh viện** (Bệnh viện Quân y 4). VPS: `/opt/qlbs`, user `bvqy4`, Docker Compose.
- **Backend** `backend/`: NestJS + Drizzle ORM + PostgreSQL + Redis, prefix `/api` (không có `/v1`). Build: `npx nest build` → `node dist/main.js`.
- **Frontend** `frontend/`: Next.js (app router) + React Query + Tailwind; proxy `/api` → `API_PROXY_TARGET` **đóng băng lúc build**. Không chuyển `output: 'standalone'`.
- **Docker**: node:22-alpine, uid 1000, cache npm/next bằng `RUN --mount=type=cache` (không dùng `# syntax=` — gây lỗi grpc). Upload mount `${UPLOAD_HOST_DIR:-./data/uploads}:/app/uploads`.
- **Tài liệu**: `docs/HUONG-DAN-SU-DUNG.md`, `PHAN-QUYEN.md`, `API.md`, `TRIEN-KHAI.md`, `KIEN-TRUC.md` — cập nhật khi thêm tính năng.
- **Deploy**: `deploy/install.sh` (lần đầu), `deploy/update.sh` (cập nhật: dựng lần lượt, thử lại 3 lần lỗi mạng/BuildKit, `--backup`, `--no-pull`), `deploy/install-times-font.sh`.

### UI kit frontend (dùng lại, đừng viết mới)
`CrudTable`; `Dialog` (size `'full'|'lg'…`, z-50, Esc đóng), `ConfirmDialog` từ `ui/dialog`; `Badge` (tone default/success/warning/danger/info/muted/brand), `Card`, `EmptyState`, `Skeleton` từ `ui/card`; `Button` (variant default/outline/ghost, size sm/icon, `loading`); `Input/Label/Select/Switch` từ `ui/input`; `TableWrap/Th/Td/Tr` từ `ui/table` (`TableWrap` đã chứa `<table>`); `apiFetch` (`raw:true` trả Response), `downloadFile`; icon `lucide-react` 1.48; toast `sonner`; `useAuth(s=>s.can)`. CSS vars: `--primary --accent --muted-foreground --border --card --danger --muted --background`.

### Backend — lưu ý
- DTO: `ValidateIf(hasValue)`; `@Type(Number)` biến `""` thành 0.
- Không có multer → upload bằng stream octet-stream `?name=`.
- Không dùng `cache.flushAll()` sau restore.

## 3. Môi trường dev trong sandbox

- **Dựng lại sau reset:** `bash /home/user/qlbv/.ai/dev-setup.sh` (cài PG/Redis/poppler/cabextract, tạo DB `qlbs` pass `postgres`, sửa `backend/.env`, TNR vào `/tmp/qlbs-storage/fonts`, npm ci, build, Playwright ở `/tmp/pw`). DB mới → khởi động API rồi `bash .ai/dev-setup.sh --demo`.
- **Khởi động (dùng start_process, không chạy nền trong bash):**
  - API: `cd /home/user/qlbv/backend && node dist/main.js > /tmp/api.log 2>&1` (port 4000)
  - Web: `cd /home/user/qlbv/frontend && npx next start -H 0.0.0.0 -p 3000 > /tmp/fe.log 2>&1` (sau `npx next build`)
  - Đăng nhập **admin / Admin@123**; demo: `tk.nam / 123456`, `tc.hoa / 123456`…
- **API bằng curl:** login `POST /api/auth/login` → lấy `accessToken` → header `Authorization: Bearer` (cookie không dùng được qua curl).
- **Playwright:** `require('/tmp/pw/node_modules/playwright')`; mẫu kịch bản: `.ai/examples/ui-designer-test.js`.
- **Dọn dung lượng:** `bash .ai/dev-setup.sh --clean`. Workspace giới hạn ~128MB; `node_modules`, `.next`, `dist`, `/tmp` KHÔNG được lưu → luôn dựng lại bằng script.

### Bẫy đã gặp (đừng lặp lại)
- `npm run dev:fast` (tsx) crash do thiếu decorator metadata → dùng `nest build` + `node dist/main.js`.
- Không `pkill -f "node dist/main.js"` trong bash (giết chính lệnh) → dùng stop_process.
- Chạy `npx tsc` trước `npm ci` sẽ cài nhầm gói. apt báo 404 → `apt-get update` trước.
- PGlite dễ lỗi → dùng PostgreSQL thật. Không có docker, eslint, xxd, bc trong sandbox.
- Không commit font Microsoft vào repo; không đổi tên Tinos thành "Times New Roman".
- `pdftoppm -f 1 -l 1` ra tệp `xxx-1.png`.

## 4. Lịch sử yêu cầu đã hoàn thành (commit trên `main`)

| # | Nội dung | Commit |
|---|---|---|
| 1 | Đọc hiểu repo | — |
| 2 | Sửa "Application error" phía client 8 trang (TDZ loadPresets, phân trang workflows, sessions, profile roles) | 7d54dfb |
| 3 | Gán vai trò, PDF 401 (cookie `qlbs_access`), `deploy/update.sh` | 0a185ca |
| 4 | Docker web truyền `API_PROXY_TARGET` lúc build | 66fcd21 |
| 5 | npm ci cache tách theo service, retry mạng, dựng lần lượt | de9096c |
| 6 | Sao lưu CSDL đầy đủ, tác vụ định kỳ | 921bf8b |
| 7 | Sao lưu & phục hồi trên giao diện | 3d779c4 |
| 8 | Phục hồi an toàn nhiều người dùng (bảo trì 503 `MAINTENANCE`, gõ `PHUC HOI`, bản `-truoc-phuc-hoi`) | ad77d75, ac09272 |
| 9 | Danh mục Chức danh (`/job-titles`, quyền `job_title.*`), menu Danh mục; import nhân viên Excel/CSV/TXT (`/users/import/file`, mẫu `/users/import/template`, ≤10MB/5000 dòng, MK mặc định `Qlbs@123456`); email/SĐT/ghi chú không bắt buộc | f6db7cc |
| 10 | **Bản in mặc định Times New Roman** (kể cả xem trước PDF) + **trình thiết kế bản in toàn màn hình** kiểu phần mềm thương mại | 8b4fba3 |
| 10b | Docker build ổn định (bỏ `# syntax=`, update.sh thử lại 3 lần, gợi ý swap) — người dùng xác nhận VPS cập nhật OK | c63401e |
| 12 | Dọn workspace, tạo thư mục `.ai/` (STATE.md, dev-setup.sh, examples) | c79caa1 |
| 13 GĐ1 | **Phân hệ Quản lý tài sản — lõi**: schema+migration 0006, API (danh mục, hồ sơ, chứng từ duyệt, khấu hao TT23/tháng/DB, in tem, biên bản PDF, import/export), 11 trang giao diện `/tai-san/*`, `/ts/<mã>` | (commit này) |

Sao lưu: job `BACKUP_HANG_NGAY` 23:30, giữ 14 bản, tệp `qlbs-<stamp>[-label].json.gz` v2.

## 5. Kiến trúc bản in (Yêu cầu 10) — tham chiếu nhanh

- **Font** `backend/src/infra/rendering/font-registry.ts`: mặc định `Times New Roman`; ưu tiên font tải lên ở `STORAGE_DIR/fonts` (VPS: `data/uploads/fonts`), fallback nhúng sẵn Tinos/Arimo/Cousine (`backend/assets/fonts`, OFL). Tự nạp lại mỗi 5s. API: `GET/POST/DELETE /print/fonts`, `GET /print/fonts/file`.
- **Renderer** `backend/src/infra/rendering/pdf-renderer.ts` (`renderPrintDocument`): toạ độ mm; phần tử `text|field|table|line|rect|image|pageNumber|datetime|qrcode|barcode|signature`; `{path}` interpolate, `formatValue`, anchor header/footer, `repeatOnEveryPage`, `visibleWhen`, `autoShrink`, bảng nhiều trang (`dataSource`, zebra, totalRow, pushDown), watermark, pageNumbering, `data.system.{day,month,year,date,datetime,page,pages}`. Mọi PDF (HSBA, báo cáo) đi qua renderer này.
- **Dữ liệu in HSBA**: `hsba.service.ts buildPrintData` → `request.*`, field trải phẳng, `signature[stepKey].{fullName,signedTime,…}`; endpoint `GET /hsba/requests/:id/print-data`.
- **Frontend** `frontend/src/components/printing/`:
  - `print-designer.tsx` — khung toàn màn hình (`fixed inset-0 z-[45]`): ribbon Trang chủ/Chèn/Bố trí/Trang in/Xem, cột trái (Công cụ/Trường/Đối tượng/Trang/JSON), inspector phải, thanh trạng thái, phím tắt, menu chuột phải, history (apply/live/commit), clipboard localStorage `qlbs.print.clipboard`.
  - `designer-canvas.tsx` (thước, lưới, marquee, smart guides, resize, sửa chữ trực tiếp, `DND_MIME`), `element-view.tsx` (vẽ phần tử giống PDF), `designer-inspector.tsx`, `preview-dialog.tsx` (dữ liệu mẫu/phiếu HSBA thật/JSON), `font-manager.tsx`, `print-fonts.ts` (`usePrintFonts`), `print-format.ts` (`buildSampleData`, format), `print-types.ts`.
  - Trang `frontend/src/app/(app)/quan-tri/mau-in/page.tsx`: danh sách mẫu + mở designer; "Thông tin mẫu" là dialog; lưu giữ designer mở.

## 6. Việc đang mở / đề xuất

### Yêu cầu 13 (đang làm): Phân hệ QUẢN LÝ TÀI SẢN + báo cáo/dashboard + realtime + làm lại RBAC
Nguyên văn: "viết tiếp phân hệ quản lý tài sản chuyên nghiệp, chi tiết, chuyên sâu, barcode, kiểm kê, in tem… tích hợp đồng bộ, logic với tính năng hiện tại, thêm phần quản lý tạo, edit report, dashboard cho từng phân hệ… cực đẹp chuyên nghiệp, đồng bộ thời gian thực…, cải tiến user, role, permission dễ nhìn, logic, chuyên sâu".

**Quyết định của người dùng (ask_user):**
- Thứ tự: GĐ1 lõi tài sản (✅ xong) → **GĐ2 kiểm kê (quét camera offline rồi đồng bộ + máy quét), bảo trì/sửa chữa kế hoạch, báo cáo tài sản** → GĐ3 trình tạo báo cáo + dashboard mọi phân hệ + realtime → GĐ4 làm lại User/Role/Permission. Mỗi GĐ = 1 lần push, test kỹ.
- Khấu hao: cả hao mòn năm TT23, đường thẳng tháng, số dư giảm dần — cấu hình theo loại/từng tài sản.
- In tem: máy in nhiệt + decal A4. Quét: camera + máy quét USB/BT. Phạm vi: mọi loại tài sản (TBYT: rủi ro A–D, số lưu hành, kiểm định/bảo dưỡng).

**GĐ1 đã làm (tham chiếu):**
- Backend `backend/src/modules/assets/`: `assets.service` (phạm vi khoa: `asset.view-all` hoặc departmentIds hoặc custodian=mình; trường CONTROLLED bị khoá khi `hasHistory`), `asset-transactions.service` (NHAP→CHO_DUYET→DA_DUYET/TU_CHOI/DA_HUY, duyệt khoá dòng FOR UPDATE), `asset-depreciation.service` + `depreciation.ts` (đã kiểm chứng số liệu), `asset-labels.service` (THERMAL/SHEET, đổi tiền tố binding `rN.`), `asset-voucher.service` + `asset-voucher-template.ts` (biên bản `BIEN_BAN_TAI_SAN`), `asset-io.service` (import dry-run/export), `asset-catalogs.service`.
- Mẫu in seed: `TEM_TAI_SAN`, `BIEN_BAN_TAI_SAN` (module `ASSET`). Cấu hình mới: `hospital.parentName`, `hospital.place`.
- Frontend: `lib/assets.ts`, `components/assets/{asset-ui,asset-form,asset-import}.tsx`, trang `app/(app)/tai-san/{page,danh-sach,[id],nghiep-vu,nghiep-vu/tao-moi,nghiep-vu/[id],khau-hao,in-tem,tra-cuu,danh-muc}`, `app/(app)/ts/[code]`. Màu nhấn teal-600. Menu nhóm "Quản lý tài sản".
- Test: `node .ai/examples/asset-api-test.mjs` (48 ca) và `node .ai/examples/asset-ui-test.js` (Playwright, ảnh `/tmp/shots/a*.png`).
- Bẫy: `.env` dev `DB_POOL_MAX=1` → **không dùng `this.db.db` trong `transaction()`**, luôn truyền `tx`; POST trả file cần `@HttpCode(200)`; lỗi Drizzle xem `e.cause`.

- (Đề xuất, chờ người dùng) Script chép bản sao lưu sang NAS/cloud — cần người dùng cho biết đích đến.
