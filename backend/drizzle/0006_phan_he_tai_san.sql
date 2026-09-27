-- Phân hệ Quản lý tài sản: danh mục, hồ sơ tài sản, chứng từ nghiệp vụ, dòng thời gian, khấu hao
CREATE TABLE IF NOT EXISTS "asset_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"path" text DEFAULT '' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'TSCD_HUU_HINH' NOT NULL,
	"group_code" text DEFAULT 'KHAC' NOT NULL,
	"code_prefix" text DEFAULT '' NOT NULL,
	"depreciation_method" text DEFAULT 'STRAIGHT_LINE_YEARLY' NOT NULL,
	"useful_life_months" integer DEFAULT 60 NOT NULL,
	"annual_rate" numeric(7, 3) DEFAULT 0 NOT NULL,
	"requires_calibration" boolean DEFAULT false NOT NULL,
	"calibration_interval_months" integer DEFAULT 0 NOT NULL,
	"maintenance_interval_months" integer DEFAULT 0 NOT NULL,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_depreciation_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"method" text NOT NULL,
	"cost_basis" numeric(18, 2) DEFAULT 0 NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"accumulated_before" numeric(18, 2) DEFAULT 0 NOT NULL,
	"accumulated_after" numeric(18, 2) DEFAULT 0 NOT NULL,
	"book_value_after" numeric(18, 2) DEFAULT 0 NOT NULL,
	"department_id" integer,
	"category_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_depreciation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"period_type" text NOT NULL,
	"status" text DEFAULT 'DA_CHOT' NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transaction_id" integer,
	"user_id" integer,
	"user_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_funding_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"path" text DEFAULT '' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'PHONG' NOT NULL,
	"department_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"roles" text[] DEFAULT '{NCC}'::text[] NOT NULL,
	"tax_code" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_transaction_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"tx_date" date NOT NULL,
	"status" text DEFAULT 'NHAP' NOT NULL,
	"from_department_id" integer,
	"to_department_id" integer,
	"to_location_id" integer,
	"to_custodian_id" integer,
	"to_custodian_name" text DEFAULT '' NOT NULL,
	"deliverer_name" text DEFAULT '' NOT NULL,
	"receiver_name" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"decision_no" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"supplier_id" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"submitted_at" timestamp with time zone,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"reject_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"category_id" integer,
	"kind" text DEFAULT 'TSCD_HUU_HINH' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"serial_number" text DEFAULT '' NOT NULL,
	"manufacturer_id" integer,
	"supplier_id" integer,
	"country_of_origin" text DEFAULT '' NOT NULL,
	"year_of_manufacture" integer,
	"specifications" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'Cái' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"original_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"funding_source_id" integer,
	"funding_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acquisition_date" date,
	"in_use_date" date,
	"invoice_no" text DEFAULT '' NOT NULL,
	"contract_no" text DEFAULT '' NOT NULL,
	"warranty_until" date,
	"depreciation_method" text DEFAULT 'STRAIGHT_LINE_YEARLY' NOT NULL,
	"useful_life_months" integer DEFAULT 60 NOT NULL,
	"annual_rate" numeric(7, 3) DEFAULT 0 NOT NULL,
	"depreciation_start_date" date,
	"residual_value" numeric(18, 2) DEFAULT 0 NOT NULL,
	"opening_accumulated" numeric(18, 2) DEFAULT 0 NOT NULL,
	"opening_date" date,
	"accumulated_depreciation" numeric(18, 2) DEFAULT 0 NOT NULL,
	"last_depreciation_period" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'TRONG_KHO' NOT NULL,
	"condition" text DEFAULT 'TOT' NOT NULL,
	"department_id" integer,
	"location_id" integer,
	"custodian_id" integer,
	"custodian_name" text DEFAULT '' NOT NULL,
	"parent_id" integer,
	"risk_class" text DEFAULT '' NOT NULL,
	"registration_no" text DEFAULT '' NOT NULL,
	"requires_calibration" boolean DEFAULT false NOT NULL,
	"calibration_interval_months" integer DEFAULT 0 NOT NULL,
	"last_calibration_date" date,
	"next_calibration_date" date,
	"maintenance_interval_months" integer DEFAULT 0 NOT NULL,
	"last_maintenance_date" date,
	"next_maintenance_date" date,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"last_inventory_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_depreciation_lines_run_id_asset_depreciation_runs_id_fk') THEN ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_run_id_asset_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."asset_depreciation_runs"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_depreciation_lines_asset_id_assets_id_fk') THEN ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_events_asset_id_assets_id_fk') THEN ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_locations_department_id_departments_id_fk') THEN ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transaction_items_transaction_id_asset_transactions_id_fk') THEN ALTER TABLE "asset_transaction_items" ADD CONSTRAINT "asset_transaction_items_transaction_id_asset_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."asset_transactions"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transaction_items_asset_id_assets_id_fk') THEN ALTER TABLE "asset_transaction_items" ADD CONSTRAINT "asset_transaction_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_from_department_id_departments_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_to_department_id_departments_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_to_location_id_asset_locations_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_to_location_id_asset_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."asset_locations"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_to_custodian_id_users_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_to_custodian_id_users_id_fk" FOREIGN KEY ("to_custodian_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_supplier_id_asset_suppliers_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_supplier_id_asset_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."asset_suppliers"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_created_by_users_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_transactions_approved_by_users_id_fk') THEN ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_category_id_asset_categories_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE restrict ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_manufacturer_id_asset_suppliers_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_manufacturer_id_asset_suppliers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."asset_suppliers"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_supplier_id_asset_suppliers_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_supplier_id_asset_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."asset_suppliers"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_funding_source_id_asset_funding_sources_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_funding_source_id_asset_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."asset_funding_sources"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_department_id_departments_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_location_id_asset_locations_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_asset_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."asset_locations"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_custodian_id_users_id_fk') THEN ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_id_users_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_categories_code_uq" ON "asset_categories" USING btree (lower("code"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_categories_parent_idx" ON "asset_categories" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_categories_path_idx" ON "asset_categories" USING btree ("path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_depr_lines_run_idx" ON "asset_depreciation_lines" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_depr_lines_asset_idx" ON "asset_depreciation_lines" USING btree ("asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_depr_runs_period_uq" ON "asset_depreciation_runs" USING btree ("period") WHERE status = 'DA_CHOT';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_events_asset_idx" ON "asset_events" USING btree ("asset_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_funding_sources_code_uq" ON "asset_funding_sources" USING btree (lower("code"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_locations_code_uq" ON "asset_locations" USING btree (lower("code"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_locations_parent_idx" ON "asset_locations" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_locations_dept_idx" ON "asset_locations" USING btree ("department_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_suppliers_code_uq" ON "asset_suppliers" USING btree (lower("code"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_tx_items_tx_idx" ON "asset_transaction_items" USING btree ("transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_tx_items_asset_idx" ON "asset_transaction_items" USING btree ("asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_tx_items_uq" ON "asset_transaction_items" USING btree ("transaction_id","asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_transactions_code_uq" ON "asset_transactions" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_transactions_type_idx" ON "asset_transactions" USING btree ("type","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_transactions_date_idx" ON "asset_transactions" USING btree ("tx_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_code_uq" ON "assets" USING btree (lower("code"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_barcode_idx" ON "assets" USING btree ("barcode");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_serial_idx" ON "assets" USING btree ("serial_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_category_idx" ON "assets" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_dept_status_idx" ON "assets" USING btree ("department_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_location_idx" ON "assets" USING btree ("location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_status_idx" ON "assets" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_next_cal_idx" ON "assets" USING btree ("next_calibration_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_next_mt_idx" ON "assets" USING btree ("next_maintenance_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_parent_idx" ON "assets" USING btree ("parent_id");
--> statement-breakpoint
-- Nguồn vốn mặc định (sửa được tại Tài sản → Danh mục)
INSERT INTO "asset_funding_sources" ("code","name","sort_order") VALUES
 ('NSNN','Ngân sách nhà nước',1),('QPTSN','Quỹ phát triển hoạt động sự nghiệp',2),
 ('VIEN_TRO','Viện trợ, tài trợ, biếu tặng',3),('XHH','Xã hội hoá / liên doanh liên kết',4),('KHAC','Nguồn khác',5)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Loại tài sản mặc định — tỉ lệ hao mòn THAM KHẢO theo Phụ lục TT23/2023/TT-BTC; tài sản quốc phòng áp dụng quy định riêng của BQP → kiểm tra & sửa lại
INSERT INTO "asset_categories" ("code","name","kind","group_code","code_prefix","depreciation_method","useful_life_months","annual_rate","requires_calibration","calibration_interval_months","maintenance_interval_months","sort_order","note") VALUES
 ('TBYT','Trang thiết bị y tế','TSCD_HUU_HINH','THIET_BI_Y_TE','TBYT','STRAIGHT_LINE_YEARLY',96,12.5,true,12,6,1,'Tỉ lệ tham khảo — đối chiếu quy định hiện hành'),
 ('CNTT','Máy vi tính, thiết bị CNTT','TSCD_HUU_HINH','CNTT','CNTT','STRAIGHT_LINE_YEARLY',60,20,false,0,12,2,'Tỉ lệ tham khảo TT23: 5 năm, 20%/năm'),
 ('VP','Máy móc, thiết bị văn phòng','TSCD_HUU_HINH','MAY_MOC','VP','STRAIGHT_LINE_YEARLY',60,20,false,0,12,3,'Máy photocopy, máy in… — tham khảo TT23: 5 năm, 20%/năm'),
 ('NT','Bàn ghế, tủ, đồ nội thất','TSCD_HUU_HINH','NOI_THAT','NT','STRAIGHT_LINE_YEARLY',96,12.5,false,0,0,4,'Tỉ lệ tham khảo — đối chiếu quy định hiện hành'),
 ('PT','Phương tiện vận tải','TSCD_HUU_HINH','PHUONG_TIEN','PT','STRAIGHT_LINE_YEARLY',120,10,false,0,6,5,'Tỉ lệ tham khảo — đối chiếu quy định hiện hành'),
 ('NHA','Nhà cửa, vật kiến trúc','TSCD_HUU_HINH','NHA_CUA','NHA','STRAIGHT_LINE_YEARLY',600,2,false,0,0,6,'Tỉ lệ tham khảo — đối chiếu quy định hiện hành'),
 ('VH','Tài sản cố định vô hình (phần mềm…)','TSCD_VO_HINH','CNTT','VH','STRAIGHT_LINE_YEARLY',60,20,false,0,0,7,'Thời gian hao mòn TSCĐ vô hình 4–50 năm'),
 ('CCDC','Công cụ, dụng cụ','CCDC','CCDC','CCDC','NONE',24,0,false,0,0,8,'Không tính hao mòn — theo dõi số lượng, tình trạng')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "asset_categories" ("code","name","parent_id","level","kind","group_code","code_prefix","depreciation_method","useful_life_months","annual_rate","requires_calibration","calibration_interval_months","maintenance_interval_months","sort_order")
SELECT v.code, v.name, p.id, 2, p.kind, p.group_code, v.prefix, p.depreciation_method, p.useful_life_months, p.annual_rate, p.requires_calibration, p.calibration_interval_months, p.maintenance_interval_months, v.ord
FROM (VALUES
 ('TBYT-CDHA','Chẩn đoán hình ảnh (X-quang, CT, MRI, siêu âm)','TBYT','CDHA',1),
 ('TBYT-XN','Xét nghiệm','TBYT','XN',2),
 ('TBYT-HSCC','Hồi sức cấp cứu (máy thở, monitor, sốc điện)','TBYT','HSCC',3),
 ('TBYT-PT','Phẫu thuật, gây mê','TBYT','PTGM',4),
 ('TBYT-TDCN','Thăm dò chức năng, nội soi','TBYT','TDCN',5),
 ('TBYT-KHAC','Thiết bị y tế khác','TBYT','TBYT',6),
 ('CNTT-MT','Máy tính để bàn, xách tay','CNTT','MT',1),
 ('CNTT-MANG','Thiết bị mạng, máy chủ','CNTT','MANG',2),
 ('VP-IN','Máy in, máy photocopy, máy scan','VP','IN',1),
 ('VP-DH','Điều hoà, thiết bị điện','VP','DH',2)
) AS v(code,name,parent,prefix,ord)
JOIN "asset_categories" p ON p.code = v.parent
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "asset_categories" SET "path" = '/' || "id" || '/' WHERE "parent_id" IS NULL AND "path" = '';
--> statement-breakpoint
UPDATE "asset_categories" c SET "path" = p."path" || c."id" || '/' FROM "asset_categories" p WHERE c."parent_id" = p."id" AND c."path" = '';
