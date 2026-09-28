# Kiến trúc hệ thống — QLBS

> Phần mềm Quản lý Bệnh viện: sửa hồ sơ bệnh án (ký số nhiều bước), báo cáo công tác
> của khoa, và các tiện ích mở rộng được cấu hình hoàn toàn từ giao diện.

## 1. Tổng quan

```
┌────────────────────────────┐        ┌──────────────────────────────────┐
│  Trình duyệt (máy tính,    │  HTTP  │  Web (Next.js 15, App Router)    │
│  máy tính bảng, điện thoại)├───────►│  · giao diện shadcn/ui + Tailwind│
└────────────────────────────┘        │  · chuyển tiếp /api → API        │
                                      └──────────────┬───────────────────┘
                                                     │ /api/*
                                      ┌──────────────▼───────────────────┐
                                      │  API (NestJS 11, TypeScript)     │
                                      │  · JWT + PBAC (80 quyền)         │
                                      │  · nghiệp vụ theo mô-đun         │
                                      └───┬───────────┬──────────────┬───┘
                                          │           │              │
                              ┌───────────▼──┐  ┌─────▼─────┐  ┌─────▼─────────┐
                              │ PostgreSQL 16 │  │ Redis 7   │  │ Tệp (đĩa)     │
                              │ dữ liệu chính │  │ cache +   │  │ tải lên,      │
                              │ (Drizzle ORM) │  │ hàng đợi  │  │ bản in, sao   │
                              └───────────────┘  └───────────┘  │ lưu           │
                                                                └───────────────┘
```

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| API | NestJS 11.2, TypeScript 5.9 | mô-đun hoá, DTO + class-validator, Swagger tại `/api/docs` |
| ORM | Drizzle ORM 0.45 + `pg` | schema khai báo bằng TypeScript, migration sinh tự động |
| CSDL | PostgreSQL 16 | 31 bảng, 80 chỉ mục (kể cả GIN tìm kiếm) |
| Cache | Redis 7 (hoặc bộ nhớ khi chạy thử) | đệm danh mục, quyền, số liệu tổng hợp |
| Hàng đợi | BullMQ trên Redis (hoặc chạy trong tiến trình) | thông báo, xuất tệp, sao lưu, việc định kỳ |
| Web | Next.js 15.5 (App Router), React 19 | Tailwind CSS 4 + shadcn/ui, biểu đồ Recharts |
| In ấn | pdfmake + pdf-lib + fontkit | khổ A4, font Tinos/Times hỗ trợ tiếng Việt |
| Xuất tệp | ExcelJS (xlsx), docx (Word), PDF | dùng chung một mẫu thiết kế bản in |

## 2. Mô-đun nghiệp vụ

| Mô-đun | Trách nhiệm | Bảng dữ liệu chính |
|---|---|---|
| `auth` | đăng nhập, làm mới token, phiên, đổi mật khẩu, hồ sơ cá nhân | `users`, `login_logs` |
| `users`, `roles` | người dùng, vai trò, gán quyền, phạm vi dữ liệu | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_department_scopes` |
| `departments` | cây tổ chức nhiều cấp (Viện → Khối → Khoa → Phòng) | `departments` |
| `hsba` | phiếu đề nghị sửa hồ sơ bệnh án, quy trình ký, chữ ký số | `hsba_requests`, `hsba_workflows`, `hsba_signatures`, `hsba_logs` |
| `reports` | mẫu báo cáo động (mục/nhóm/dòng/cột), nhập số liệu, tổng hợp, **chốt số liệu** | `report_templates`, `report_sections`, `report_blocks`, `report_rows`, `report_columns`, `report_entries`, `report_entry_audits`, `report_snapshots` |
| `printing` | mẫu in động (khổ giấy, lề, font, ảnh, chữ ký), phiên bản mẫu, kết xuất PDF/Excel/Word | `print_templates`, `print_template_versions` |
| `utilities` | menu tiện ích động theo quyền, sắp xếp, nhóm | `utilities` |
| `scheduler` | tác vụ định kỳ (cron), lịch sử chạy, chạy tay | `scheduled_jobs`, `job_runs` |
| `audit` | nhật ký thao tác toàn hệ thống | `audit_logs` |
| `settings` | cấu hình hệ thống theo nhóm, khôi phục mặc định | `settings` |
| `notifications` | thông báo trong hệ thống | `notifications` |
| `dashboard` | số liệu tổng quan theo phạm vi người dùng | (tổng hợp, có cache) |
| `ops` (nền) | tệp đính kèm, nhập/xuất dữ liệu, sao lưu | `attachments`, `data_jobs`, `backups` |
| `studio` | query engine an toàn + trang bảng điều khiển/báo cáo tuỳ biến (kéo-thả), xuất Excel | `studio_pages` |
| `realtime` | SSE: phát sự kiện thay đổi dữ liệu theo chủ đề, chiếu phạm vi người nhận | (bộ nhớ, không bảng) |

### Studio — query engine

Giao diện kéo-thả (Power BI thu nhỏ) nhưng **mọi câu hỏi chạy phía máy chủ**:
nguồn dữ liệu được khai báo tường minh (`studio.sources.ts`: HSBA, nhập liệu báo
cáo, người dùng, tài sản, chứng từ, kiểm kê, thông báo…), mỗi nguồn kèm quyền xem
bắt buộc và danh sách trường/toán tử cho phép. `dataSpec` chỉ chứa từ khoá
(`source, metrics[agg,field], dimensions, filters[op], dateRange, orderBy, limit`)
→ dịch sang SQL có sẵn mối quan hệ, áp `departmentScope`/phạm vi OWN/ALL của vai
trò. Không có SQL tự do từ client. Xuất Excel dùng ExcelJS stream qua
`POST /studio/query/export`. Trang lưu ở 3 phạm vi (`SYSTEM/ROLE/PERSONAL`) trong
`studio_pages` (xoá mềm, mã duy nhất theo phạm vi), mỗi phạm vi tối đa 1 trang mặc
định — chọn theo độ ưu tiên cá nhân → vai trò → hệ thống.

### Realtime — SSE thay WebSocket

Chọn **Server-Sent Events** qua đường `/api/realtime/stream` (đi qua proxy Next nên
một miền, không cấu hình CORS riêng, tự kết nối lại): mỗi sự kiện nghiệp vụ
(`hsba-request.created/updated/signed`, `asset.*`, `notification.created`…) được
`RealtimeService.emit(topic, event, data, scope)` đẩy tới đúng subscriber của chủ
đề, lọc theo phạm vi dữ liệu (ví dụ trưởng khoa chỉ nhận sự kiện phiếu của khoa
mình; người dùng thường chỉ nhận thông báo của mình). Keep-alive 25 giây, phát
hiện đứt kết nối bằng heartbeat. Frontend: `RealtimeProvider` mở **một**
`EventSource` dùng chung (JWT qua query vì EventSource không đặt header, chỉ chấp
nhận ở endpoint này), `useRealtimeEvent` cho mọi màn hình + ánh xạ nguồn→chủ đề để
ô Studio tự làm mới; nhãn "Trực tiếp" trên topbar báo trạng thái kết nối.

## 3. Luồng nghiệp vụ 1 — Phiếu đề nghị sửa hồ sơ bệnh án

```
Người đề nghị        Duyệt – TB.KHTH          Tài chính
     │                     │                       │
 tạo phiếu ──► CHO_DE_NGHI │                       │
     │                     │                       │
 ký bước 1 ──► CHO_KHTB ──►│                       │
     │                     │                       │
     │◄── trả lại (TRA_LAI)┤ (kèm lý do)           │
     │  sửa nội dung, xoá chữ ký cũ, gửi lại       │
     │                     │                       │
     │              ký bước 2 ──► CHO_TAICHINH ───►│
     │                     │             ký bước 3 ──► HOAN_TAT
```

* **Trạng thái** = `CHO_<mã bước>` khi đang chờ một bước; `TRA_LAI` khi bị trả lại
  (vẫn chờ bước đầu của quy trình); `HOAN_TAT`, `DA_HUY` khi kết thúc.
* **Quy trình ký** cấu hình được: mỗi khoa có thể dùng quy trình riêng, mỗi bước có
  loại người ký (`requester`, `creator`, `dept_head`, `role` + danh sách vai trò),
  có cho trả lại hay không, có bắt buộc ghi ý kiến hay không.
* **Chữ ký số**: mỗi lần ký lưu `sha256(mã phiếu | người bệnh | mã KCB | mã thẻ |
  lý do | nội dung | số tiền | bước)` (32 ký tự hex), kèm IP, thiết bị, thời điểm.
  Trang chi tiết kiểm tra lại hàm băm để cảnh báo nếu nội dung đã đổi sau khi ký.
* **Trả lại phiếu** xoá toàn bộ chữ ký cũ (ghi nhật ký `UNSIGN`): nội dung sửa xong
  thì người đề nghị ký lại, các bước sau duyệt lại từ đầu.
* Mọi thao tác ghi vào `hsba_logs` với trạng thái trước/sau, người thực hiện, IP.

## 4. Luồng nghiệp vụ 2 — Báo cáo công tác của khoa

```
Cấu hình (quản trị)                 Nhập liệu (khoa)                 Tổng hợp & chốt
──────────────────                  ────────────────                 ───────────────
Mẫu báo cáo                         Mở lưới theo kỳ                  /bao-cao  (một khoa)
 ├─ Mục (Section)                    (ngày/tuần/tháng/quý/năm/         /bao-cao/tong-hop
 │   ├─ Nhóm (Block, tuỳ chọn)        khoảng/toàn bộ)                  (toàn viện)
 │   │   └─ Dòng (Row)               nhập từng ô hoặc dán từ Excel     │
 │   └─ Dòng (Row)                    → lưu (ghi nhật ký từng ô)      Chốt số liệu
 └─ Cột (Column): INPUT | CALC         công thức CALC tự tính          → DRAFT → APPROVED → LOCKED
    · INPUT: nhập tay                 xuất Excel / Word / PDF
    · CALC : công thức tham chiếu cột khác
    · summaryKey: gom vào tổng hợp toàn viện
```

* **Cột** có `kind` = `INPUT` (nhập) hoặc `CALC` (công thức, tham chiếu cột cùng dòng),
  `agg` để gộp theo kỳ (`sum` | `first` | `last`), `summaryKey` để đưa vào bảng tổng
  hợp toàn viện, `format`, độ rộng, căn lề, in đậm.
* **Số liệu** lưu theo ô: (mẫu, dòng, cột, ngày) là duy nhất; mọi thay đổi lưu vết
  trong `report_entry_audits` (giá trị cũ → mới, ai sửa, khi nào).
* **Chốt số liệu** lưu nguyên trạng bảng số liệu vào `report_snapshots.payload`
  để số liệu đã báo cáo không bị ảnh hưởng khi sửa về sau; có duyệt và khoá.

## 5. Bảo mật & phân quyền

* Đăng nhập bằng JWT (access 60 phút + refresh 12 giờ), mật khẩu băm bcrypt.
* Khoá tài khoản tạm thời sau nhiều lần sai mật khẩu (`MAX_FAILED_LOGINS`, `LOCK_MINUTES`).
* **PBAC**: mỗi endpoint khai báo mã quyền; 80 quyền chia theo phân hệ (xem
  [PHAN-QUYEN.md](PHAN-QUYEN.md)).
* **Phạm vi dữ liệu** theo vai trò: `ALL` (toàn viện) · `DEPT` (khoa được gán) ·
  `OWN` (chỉ dữ liệu của mình) — áp ngay trong câu truy vấn.
* Mọi thao tác ghi đều vào `audit_logs` (ai, làm gì, trên bản ghi nào, từ IP nào).

## 6. Hiệu năng

* Chỉ mục: 80 chỉ mục B-tree/GIN, gồm các chỉ mục ghép `(status, created_at)`,
  `(department_id, created_at)` cho danh sách phiếu và `(template_id, entry_date)`
  cho lưới số liệu.
* Tìm kiếm tiếng Việt **không dấu**: cột `hsba_requests.search_text` giữ chuỗi đã bỏ
  dấu, viết thường → gõ `hong anh` hay `hồng ánh` đều khớp, không cần tiện ích CSDL.
* Cache: danh mục/quyền/cấu trúc báo cáo (Redis, TTL cấu hình được), số liệu tổng
  hợp và bảng điều khiển (20 giây theo phạm vi người dùng).
* Truy vấn tổng hợp tính bằng SQL (`sum … group by`) và gom theo trang, không lọc mảng
  trong bộ nhớ.

## 7. Sơ đồ thư mục

```
backend/
  src/
    common/        # decorator, guard, filter, interceptor, tiện ích dùng chung
    config/        # đọc & kiểm tra biến môi trường
    db/            # schema Drizzle, seed-data, kết nối
    infra/         # cache, hàng đợi, scheduler, lưu tệp, PDF
    modules/       # nghiệp vụ: auth, users, roles, departments, hsba, reports, …
  drizzle/         # migration SQL (0000_init, 0001_…)
  scripts/         # migrate, seed, bootstrap, dev-postgres, demo-data, backfill
frontend/
  src/app/         # route theo App Router: (app)/… , login
  src/components/  # ui (shadcn), layout, shared, hsba, bao-cao
  src/lib/         # api, auth (zustand), utils
docs/              # tài liệu dự án
docker-compose.yml # PostgreSQL + Redis + API + Web
```
