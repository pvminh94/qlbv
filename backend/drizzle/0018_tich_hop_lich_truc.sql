-- 0018 · Tích hợp lịch trực với máy khoá phòng khám: khoá API chỉ đọc (chỉ lưu băm SHA-256, có thu hồi).
CREATE TABLE IF NOT EXISTS "integration_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scope" text DEFAULT 'duty:read' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "use_count" integer DEFAULT 0 NOT NULL,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "integration_keys_hash_uq" ON "integration_keys" USING btree ("key_hash");
