-- Yêu cầu 13 GĐ3a: Studio — bảng điều khiển & báo cáo tùy biến (canvas kéo-thả, query engine whitelist)
CREATE TABLE IF NOT EXISTS "studio_dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'DASHBOARD' NOT NULL,
	"scope" text DEFAULT 'PERSONAL' NOT NULL,
	"role_code" text DEFAULT '' NOT NULL,
	"owner_id" integer,
	"layout" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "studio_dashboards_code_unique" ON "studio_dashboards" ("code") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_dashboards_kind_idx" ON "studio_dashboards" ("kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_dashboards_scope_idx" ON "studio_dashboards" ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_dashboards_owner_idx" ON "studio_dashboards" ("owner_id");
