-- 0017 · Lịch trực: đổi màu mặc định của các ca sang bảng màu mới (idempotent).
-- Chỉ đổi những ca còn đúng màu mặc định cũ; ca đã được quản trị viên đổi màu thì giữ nguyên.
UPDATE "duty_shift_types" SET "color" = '#0F766E' WHERE "code" = 'S' AND lower("color") = '#f59e0b';
UPDATE "duty_shift_types" SET "color" = '#0369A1' WHERE "code" = 'C' AND lower("color") = '#2563eb';
UPDATE "duty_shift_types" SET "color" = '#15803D' WHERE "code" = 'CD' AND lower("color") = '#7c3aed';
UPDATE "duty_shift_types" SET "color" = '#4338CA' WHERE "code" = 'D' AND lower("color") = '#0f172a';
