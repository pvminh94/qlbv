-- 0019 · Sinh trắc học & Điểm danh Kiosk mở khoá phòng khám
CREATE TABLE IF NOT EXISTS "user_biometrics" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "face_descriptor" text NOT NULL,
  "avatar_path" text,
  "sample_count" integer DEFAULT 3 NOT NULL,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_biometrics_user_uq" ON "user_biometrics" ("user_id");

CREATE TABLE IF NOT EXISTS "duty_attendance" (
  "id" text PRIMARY KEY NOT NULL,
  "slot_id" integer REFERENCES "duty_slots"("id") ON DELETE SET NULL,
  "room_id" integer REFERENCES "duty_rooms"("id") ON DELETE SET NULL,
  "room_code" text NOT NULL,
  "room_name" text NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "username" text NOT NULL,
  "full_name" text NOT NULL,
  "title" text NOT NULL,
  "shift_code" text NOT NULL,
  "shift_name" text NOT NULL,
  "checkin_time" timestamp with time zone DEFAULT now() NOT NULL,
  "checkout_time" timestamp with time zone,
  "status" text DEFAULT 'ON_TIME' NOT NULL,
  "confidence_score" real DEFAULT 1.0 NOT NULL,
  "method" text DEFAULT 'AI_FACIAL_BIOMETRICS' NOT NULL,
  "device_info" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "duty_attendance_room_date_idx" ON "duty_attendance" ("room_code", "checkin_time");
CREATE INDEX IF NOT EXISTS "duty_attendance_user_idx" ON "duty_attendance" ("user_id");
