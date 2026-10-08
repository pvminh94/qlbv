/* ============================================================
   0015 — Lịch trực khám bệnh
   - Danh mục: phòng khám, ca trực, vai trò trực, ngày nghỉ
   - Kỳ lịch (tuần) → ô trực (ngày × phòng × ca × vai trò) → phân công
   - Nghỉ phép, yêu cầu nhường/đổi ca & ngoại lệ (gửi KHTH), nhật ký thay đổi
   - Quyền duty.* và hai vai trò mới: DIEU_PHOI_TRUC (KHTH điều phối, tài khoản đổi trực)
     và NHAN_VIEN_TRUC (nhân viên khám bệnh tự đăng ký ca)
   Toàn bộ đều idempotent — chạy lại thoải mái.
   ============================================================ */

CREATE TABLE IF NOT EXISTS "duty_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" integer,
	"location" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "duty_shift_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"is_night" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "duty_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"required_title" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "duty_closed_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "duty_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'NHAP' NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"lock_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_periods_dates_chk" CHECK ("start_date" <= "end_date"),
	CONSTRAINT "duty_periods_status_chk" CHECK ("status" IN ('NHAP', 'CONG_BO', 'DA_CHOT'))
);

CREATE TABLE IF NOT EXISTS "duty_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" integer NOT NULL,
	"duty_date" date NOT NULL,
	"room_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"required_count" integer DEFAULT 1 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_slots_required_chk" CHECK ("required_count" >= 1)
);

CREATE TABLE IF NOT EXISTS "duty_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"source" text DEFAULT 'PHAN_CONG' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "duty_absences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text DEFAULT 'KHAC' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_absences_dates_chk" CHECK ("start_date" <= "end_date")
);

CREATE TABLE IF NOT EXISTS "duty_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'CHO_NGUOI_NHAN' NOT NULL,
	"requester_id" integer NOT NULL,
	"slot_id" integer NOT NULL,
	"target_user_id" integer,
	"target_slot_id" integer,
	"replacement_user_id" integer,
	"urgent" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"response_note" text DEFAULT '' NOT NULL,
	"target_responded_at" timestamp with time zone,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_requests_type_chk" CHECK ("type" IN ('NHUONG', 'DOI', 'NGOAI_LE'))
);

CREATE TABLE IF NOT EXISTS "duty_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" integer,
	"slot_id" integer,
	"request_id" integer,
	"action" text NOT NULL,
	"actor_id" integer,
	"user_id" integer,
	"reason" text DEFAULT '' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Khoá ngoại
DO $$ BEGIN
  ALTER TABLE "duty_rooms" ADD CONSTRAINT "duty_rooms_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_periods" ADD CONSTRAINT "duty_periods_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_periods" ADD CONSTRAINT "duty_periods_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_slots" ADD CONSTRAINT "duty_slots_period_fk" FOREIGN KEY ("period_id") REFERENCES "duty_periods"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_slots" ADD CONSTRAINT "duty_slots_room_fk" FOREIGN KEY ("room_id") REFERENCES "duty_rooms"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_slots" ADD CONSTRAINT "duty_slots_shift_fk" FOREIGN KEY ("shift_id") REFERENCES "duty_shift_types"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_slots" ADD CONSTRAINT "duty_slots_role_fk" FOREIGN KEY ("role_id") REFERENCES "duty_roles"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_slot_fk" FOREIGN KEY ("slot_id") REFERENCES "duty_slots"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_absences" ADD CONSTRAINT "duty_absences_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_absences" ADD CONSTRAINT "duty_absences_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_period_fk" FOREIGN KEY ("period_id") REFERENCES "duty_periods"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_requester_fk" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_slot_fk" FOREIGN KEY ("slot_id") REFERENCES "duty_slots"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_target_user_fk" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_target_slot_fk" FOREIGN KEY ("target_slot_id") REFERENCES "duty_slots"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_replacement_fk" FOREIGN KEY ("replacement_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_requests" ADD CONSTRAINT "duty_requests_resolved_by_fk" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_logs" ADD CONSTRAINT "duty_logs_period_fk" FOREIGN KEY ("period_id") REFERENCES "duty_periods"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_logs" ADD CONSTRAINT "duty_logs_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "duty_logs" ADD CONSTRAINT "duty_logs_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Chỉ mục (duy nhất + truy vấn)
CREATE UNIQUE INDEX IF NOT EXISTS "duty_rooms_code_uq" ON "duty_rooms" USING btree (lower("code"));
CREATE INDEX IF NOT EXISTS "duty_rooms_dept_idx" ON "duty_rooms" USING btree ("department_id");
CREATE UNIQUE INDEX IF NOT EXISTS "duty_shift_types_code_uq" ON "duty_shift_types" USING btree (lower("code"));
CREATE UNIQUE INDEX IF NOT EXISTS "duty_roles_code_uq" ON "duty_roles" USING btree (lower("code"));
CREATE UNIQUE INDEX IF NOT EXISTS "duty_closed_days_date_uq" ON "duty_closed_days" USING btree ("date");
CREATE INDEX IF NOT EXISTS "duty_periods_dates_idx" ON "duty_periods" USING btree ("start_date", "end_date");
CREATE UNIQUE INDEX IF NOT EXISTS "duty_slots_uq" ON "duty_slots" USING btree ("period_id", "duty_date", "room_id", "shift_id", "role_id");
CREATE INDEX IF NOT EXISTS "duty_slots_period_date_idx" ON "duty_slots" USING btree ("period_id", "duty_date");
CREATE UNIQUE INDEX IF NOT EXISTS "duty_assignments_uq" ON "duty_assignments" USING btree ("slot_id", "user_id");
CREATE INDEX IF NOT EXISTS "duty_assignments_user_idx" ON "duty_assignments" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "duty_absences_user_idx" ON "duty_absences" USING btree ("user_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "duty_requests_status_idx" ON "duty_requests" USING btree ("status");
CREATE INDEX IF NOT EXISTS "duty_requests_requester_idx" ON "duty_requests" USING btree ("requester_id");
CREATE INDEX IF NOT EXISTS "duty_requests_target_idx" ON "duty_requests" USING btree ("target_user_id");
CREATE INDEX IF NOT EXISTS "duty_requests_period_idx" ON "duty_requests" USING btree ("period_id");
CREATE INDEX IF NOT EXISTS "duty_logs_period_idx" ON "duty_logs" USING btree ("period_id", "created_at");
CREATE INDEX IF NOT EXISTS "duty_logs_created_idx" ON "duty_logs" USING btree ("created_at");

-- 1) Vai trò mới
INSERT INTO roles (code, name, description, data_scope, is_system, priority, color)
SELECT 'DIEU_PHOI_TRUC', 'Điều phối lịch trực (KHTH)',
       'Lập kỳ lịch, chốt và công bố lịch trực; quản lý danh mục phòng/ca; duyệt ngoại lệ và đổi trực khẩn sau khi chốt (tài khoản đổi trực)',
       'ALL', true, 25, '#0891b2'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'DIEU_PHOI_TRUC');

INSERT INTO roles (code, name, description, data_scope, is_system, priority, color)
SELECT 'NHAN_VIEN_TRUC', 'Nhân viên trực khám',
       'Bác sĩ, điều dưỡng tham gia trực phòng khám: xem lịch chung, tự đăng ký ca trống, nhường/đổi ca và báo nghỉ phép',
       'OWN', true, 90, '#16a34a'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'NHAN_VIEN_TRUC');

-- 2) Quyền duty.*
INSERT INTO permissions (code, name, module, action, description)
SELECT v.code, v.name, 'duty', v.action, v.descr
FROM (VALUES
  ('duty.view', 'Xem lịch trực', 'view', 'Xem lịch trực các phòng khám và kỳ lịch đã công bố'),
  ('duty.register', 'Đăng ký / nhường / đổi ca của mình', 'register', 'Tự đăng ký ca trống, nhường hoặc đổi ca, báo nghỉ phép của chính mình'),
  ('duty.manage', 'Phân công trực (trong khoa)', 'manage', 'Tạo ô trực, phân công/gỡ người trực, ghi nhận nghỉ phép — trong phạm vi khoa được giao'),
  ('duty.manage-all', 'Điều phối toàn viện', 'manage-all', 'Phân công mọi phòng khám; xử lý ngoại lệ khi cần bỏ qua ràng buộc (có ghi lý do)'),
  ('duty.period.manage', 'Lập, chốt và công bố kỳ lịch', 'period.manage', 'Tạo kỳ lịch, cấu hình ràng buộc, công bố, chốt sớm/mở chốt'),
  ('duty.catalog.manage', 'Quản lý danh mục trực', 'catalog.manage', 'Phòng khám, ca trực, vai trò trực, ngày nghỉ'),
  ('duty.swap.approve', 'Duyệt đổi/nhường ca', 'swap.approve', 'Duyệt yêu cầu đổi/nhường ca trước khi chốt (trong phạm vi khoa)'),
  ('duty.exception.resolve', 'Xử lý ngoại lệ đổi trực (KHTH)', 'exception.resolve', 'Duyệt yêu cầu ngoại lệ sau khi chốt và đổi trực trực tiếp (tài khoản đổi trực)'),
  ('duty.export', 'Xuất / in lịch trực', 'export', 'Xuất Excel lịch trực và bảng tổng hợp giờ trực')
) AS v(code, name, action, descr)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);

-- 3) Gán quyền cho vai trò (khớp seed-data.ts)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.code = 'DIEU_PHOI_TRUC' AND p.code IN (
        'duty.view', 'duty.register', 'duty.manage', 'duty.manage-all', 'duty.period.manage',
        'duty.catalog.manage', 'duty.swap.approve', 'duty.exception.resolve', 'duty.export'))
   OR (r.code = 'NHAN_VIEN_TRUC' AND p.code IN ('duty.view', 'duty.register'))
   OR (r.code = 'KHTB' AND p.code IN (
        'duty.view', 'duty.register', 'duty.manage', 'duty.manage-all', 'duty.period.manage',
        'duty.swap.approve', 'duty.exception.resolve', 'duty.export'))
   OR (r.code = 'TRUONG_KHOA' AND p.code IN (
        'duty.view', 'duty.register', 'duty.manage', 'duty.swap.approve', 'duty.export'))
   OR (r.code = 'ADMIN' AND p.code IN ('duty.view', 'duty.catalog.manage'))
   OR (r.code = 'LANH_DAO' AND p.code IN ('duty.view'))
ON CONFLICT DO NOTHING;
