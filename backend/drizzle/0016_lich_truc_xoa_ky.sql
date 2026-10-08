-- 0016 · Lịch trực: xoá cả kỳ lịch vẫn giữ nhật ký; thêm ràng buộc kiểm tra (idempotent)

-- Nhật ký không mất khi xoá kỳ lịch: mã kỳ về NULL, nội dung đã nằm trong cột detail
ALTER TABLE "duty_logs" DROP CONSTRAINT IF EXISTS "duty_logs_period_fk";
ALTER TABLE "duty_logs" ADD CONSTRAINT "duty_logs_period_fk"
  FOREIGN KEY ("period_id") REFERENCES "duty_periods"("id") ON DELETE SET NULL;

-- Ràng buộc kiểm tra. NOT VALID: chỉ áp cho dòng mới, không quét dữ liệu cũ nên không làm hỏng khởi động.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_periods_dates_ck') THEN
    ALTER TABLE "duty_periods" ADD CONSTRAINT "duty_periods_dates_ck"
      CHECK ("start_date" <= "end_date") NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duty_shift_types_color_ck') THEN
    ALTER TABLE "duty_shift_types" ADD CONSTRAINT "duty_shift_types_color_ck"
      CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$') NOT VALID;
  END IF;
END $$;
