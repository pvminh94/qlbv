-- 0012 Khoá UNIQUE một phần cho bảng xoá mềm
-- Xoá mềm giữ nguyên dòng vật lý → UNIQUE toàn bảng chặn người dùng tạo lại
-- tên đăng nhập / mã đơn vị đã dùng trước đây (lỗi tạo phiếu ảo "đã tồn tại").
-- Giải pháp: unique index có điều kiện (partial) — chỉ chặn trùng TRONG các
-- dòng đang hoạt động (deleted_at IS NULL). Tên index giữ nguyên để đồng bộ
-- với khai báo drizzle; dòng đã xoá vẫn được lưu trữ nguyên vẹn để kiểm toán.

DROP INDEX IF EXISTS users_username_uq;
CREATE UNIQUE INDEX users_username_uq ON public.users (username)
  WHERE deleted_at IS NULL;
COMMENT ON INDEX users_username_uq IS 'Chỉ chặn trùng tên đăng nhập trong các tài khoản chưa bị xoá mềm';

DROP INDEX IF EXISTS departments_code_uq;
CREATE UNIQUE INDEX departments_code_uq ON public.departments (code)
  WHERE deleted_at IS NULL;
COMMENT ON INDEX departments_code_uq IS 'Chỉ chặn trùng mã đơn vị trong các đơn vị chưa bị xoá mềm';
