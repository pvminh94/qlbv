-- GĐ3b: ấn bản định kỳ cho trang Studio (dashboard/báo cáo tùy biến)

CREATE TABLE IF NOT EXISTS "studio_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"frequency" text DEFAULT 'DAILY' NOT NULL,
	"hour_of_day" integer DEFAULT 6 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" text DEFAULT 'PENDING' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "studio_subscription_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"page_id" integer NOT NULL,
	"page_name" text DEFAULT '' NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text DEFAULT '' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"trigger" text DEFAULT 'queue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "studio_subscriptions" ADD CONSTRAINT "studio_subscriptions_page_id_studio_dashboards_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."studio_dashboards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "studio_subscriptions" ADD CONSTRAINT "studio_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "studio_subscription_files" ADD CONSTRAINT "studio_subscription_files_subscription_id_studio_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."studio_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "studio_subscription_files" ADD CONSTRAINT "studio_subscription_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "studio_subs_page_user_uq" ON "studio_subscriptions" USING btree ("page_id","user_id","frequency","hour_of_day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_subs_due_idx" ON "studio_subscriptions" USING btree ("active","next_run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_subs_user_idx" ON "studio_subscriptions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_sub_files_user_idx" ON "studio_subscription_files" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_sub_files_sub_idx" ON "studio_subscription_files" USING btree ("subscription_id");
