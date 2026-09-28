-- 0010 — Khu vực HSBA chuẩn thương mại: trao đổi + tệp đính kèm theo phiếu
-- Hỗ trợ xóa mềm để bảo toàn dấu vết kiểm toán.

CREATE TABLE IF NOT EXISTS hsba_comments (
  id          serial PRIMARY KEY,
  request_id  integer NOT NULL REFERENCES hsba_requests(id) ON DELETE CASCADE,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  username    text NOT NULL DEFAULT '',
  full_name   text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS hsba_comments_request_idx        ON hsba_comments (request_id);
CREATE INDEX IF NOT EXISTS hsba_comments_request_created_idx ON hsba_comments (request_id, created_at);

CREATE TABLE IF NOT EXISTS hsba_attachments (
  id            serial PRIMARY KEY,
  request_id    integer NOT NULL REFERENCES hsba_requests(id) ON DELETE CASCADE,
  /** Tên gốc do ngườI đăng đặt — chỉ dùng hiển thị, tên trên đĩa do hệ thống phát sinh */
  file_name     text NOT NULL,
  mime_type     text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    integer NOT NULL DEFAULT 0,
  /** Đường dẫn tương đối trong THƯ_MỤC_LƯU_TRỮ — không bao giờ lấy từ ngoài vào */
  storage_path  text NOT NULL,
  note          text NOT NULL DEFAULT '',
  uploaded_by   integer REFERENCES users(id) ON DELETE SET NULL,
  username      text NOT NULL DEFAULT '',
  full_name     text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS hsba_attachments_request_idx ON hsba_attachments (request_id);

COMMENT ON TABLE  hsba_comments IS 'Trao đổi (bình luận) trên phiếu đề nghị sửa HSBA — phục vụ phối hợp giữa khoa, KHTH, tài chính';
COMMENT ON COLUMN hsba_comments.deleted_at IS 'Xóa mềm — chỉ tác giả hoặc ngườI có quyền xoá phiếu';
COMMENT ON TABLE  hsba_attachments IS 'Tệp đính kèm minh chứng của phiếu (ảnh chụp hồ sơ giấy, PDF BHXH từ chối…)';
COMMENT ON COLUMN hsba_attachments.storage_path IS 'Đường dẫn vật lý do máy chủ phát sinh (chống ghi đè/traversal)';
