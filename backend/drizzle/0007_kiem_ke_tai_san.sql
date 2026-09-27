-- Phân hệ Quản lý tài sản — GĐ2: kiểm kê (đợt kiểm kê, dòng kiểm kê, nhật ký quét đồng bộ offline)
CREATE TABLE IF NOT EXISTS "asset_inventories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'NHAP' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planned_date" date,
	"snapshot_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"decision_no" text DEFAULT '' NOT NULL,
	"committee" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_ids" integer[] DEFAULT '{}'::int[] NOT NULL,
	"blind" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"conclusion" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_by_name" text DEFAULT '' NOT NULL,
	"approved_by" integer,
	"approved_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_inventories_code_uq" ON "asset_inventories" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_inventories_status_idx" ON "asset_inventories" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventory_id" integer NOT NULL REFERENCES "asset_inventories"("id") ON DELETE cascade,
	"asset_id" integer REFERENCES "assets"("id") ON DELETE set null,
	"scanned_code" text DEFAULT '' NOT NULL,
	"expected" boolean DEFAULT true NOT NULL,
	"book_department_id" integer,
	"book_location_id" integer,
	"book_custodian_name" text DEFAULT '' NOT NULL,
	"book_status" text DEFAULT '' NOT NULL,
	"book_condition" text DEFAULT '' NOT NULL,
	"book_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"book_value" numeric(18, 2) DEFAULT 0 NOT NULL,
	"check_state" text DEFAULT 'CHUA_KIEM' NOT NULL,
	"actual_department_id" integer,
	"actual_location_id" integer,
	"actual_condition" text DEFAULT '' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"checked_at" timestamp with time zone,
	"checked_by" integer,
	"checked_by_name" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"resolution_tx_id" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_inv_items_inv_idx" ON "asset_inventory_items" ("inventory_id", "result");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_inv_items_asset_uq" ON "asset_inventory_items" ("inventory_id", "asset_id") WHERE asset_id is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_inv_items_asset_idx" ON "asset_inventory_items" ("asset_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_inventory_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventory_id" integer NOT NULL REFERENCES "asset_inventories"("id") ON DELETE cascade,
	"client_id" text NOT NULL,
	"code" text NOT NULL,
	"item_id" integer,
	"outcome" text DEFAULT '' NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"location_id" integer,
	"user_id" integer,
	"user_name" text DEFAULT '' NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_inv_scans_client_uq" ON "asset_inventory_scans" ("inventory_id", "client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_inv_scans_inv_idx" ON "asset_inventory_scans" ("inventory_id", "scanned_at");
