-- Kênh thông báo ngoài: liên kết tài khoản ngườI dùng với Telegram Bot
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;
COMMENT ON COLUMN "users"."telegram_chat_id" IS 'Mã chat Telegram đã liên kết (nhận thông báo qua Bot)';
