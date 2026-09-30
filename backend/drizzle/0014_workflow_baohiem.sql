/* ============================================================
   0014 — Quy trình sửa HSBA thêm bước TR.BP BẢO HIỂM
   - Vai trò mới 'BAO_HIEM' (Trưởng bộ phận bảo hiểm) + quyền ký bước;
   - Chỉ TB.KHTH và Tr.BP bảo hiểm được trả lại phiếu (Tài chính bị rút quyền return);
   - Chèn bước BAOHIEM vào quy trình MAC_DINH (đã cấu hình hệ thống);
   - Phiếu đang chờ Tài chính lùi về chờ Bảo hiểm theo quy trình mới.
   Toàn bộ đều idempotent — chạy lại thoải mái.
   ============================================================ */

-- 1) Vai trò Tr.BP bảo hiểm
INSERT INTO roles (code, name, description, data_scope, is_system, priority, color)
SELECT 'BAO_HIEM',
       'Trưởng BP bảo hiểm',
       'Trưởng bộ phận bảo hiểm: kiểm tra và xác nhận hồ sơ bảo hiểm sau khi TB.KHTH duyệt; được phép trả lại phiếu đề nghị sửa HSBA',
       'ALL', true, 20, '#7c3aed'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'BAO_HIEM');

-- 2) Quyền ký bước bảo hiểm
INSERT INTO permissions (code, name, module, action, description)
SELECT 'hsba.request.sign-insurance',
       'Xác nhận / ký Tr.BP bảo hiểm', 'hsba.request', 'sign-insurance',
       'Ký bước xác nhận bảo hiểm trong quy trình sửa HSBA'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hsba.request.sign-insurance');

-- 3) Gán bộ quyền cho vai trò mới (khớp seed)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'BAO_HIEM' AND p.code IN (
  'dashboard.view','studio.dashboard.view','studio.report.view',
  'hsba.request.view','hsba.request.view-all',
  'hsba.request.sign-insurance','hsba.request.return','hsba.request.comment',
  'hsba.request.export','hsba.request.print',
  'report.view.view','report.export.excel','utility.view')
ON CONFLICT DO NOTHING;

-- 4) Siết quyền trả lại: Tài chính không còn được trả lại phiếu
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id
  AND r.code = 'TAI_CHINH' AND p.code = 'hsba.request.return';

-- 5) Chèn bước BAOHIEM ngay sau KHTB trong quy trình MAC_DINH
WITH wf AS (
  SELECT id, steps FROM hsba_workflows
  WHERE code = 'MAC_DINH'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(steps) e WHERE e->>'key' = 'KHTB')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(steps) e WHERE e->>'key' = 'BAOHIEM')
), ins AS (
  SELECT w.id,
    (
      SELECT jsonb_agg(e.value ORDER BY e.ord)
      FROM (
        SELECT t.idx::double precision AS ord, t.value
        FROM jsonb_array_elements(w.steps) WITH ORDINALITY AS t(value, idx)
        UNION ALL
        SELECT t.idx::double precision + 0.5,
               '{"key":"BAOHIEM","name":"Tr.BP bảo hiểm xác nhận","title":"TR.BPBH XÁC NHẬN","kind":"role","roleCodes":["BAO_HIEM"],"confirmText":"Tôi đã kiểm tra hồ sơ bảo hiểm liên quan và ĐỒNG Ý cho sửa HSBA điện tử theo nội dung trên.","allowReturn":true,"requireNote":false}'::jsonb AS value
        FROM jsonb_array_elements(w.steps) WITH ORDINALITY AS t(value, idx)
        WHERE t.value->>'key' = 'KHTB'
      ) e
    ) AS new_steps
  FROM wf w
)
UPDATE hsba_workflows w
SET steps = i.new_steps
FROM ins i
WHERE w.id = i.id AND i.new_steps IS NOT NULL;

-- Cập nhật tên/mô tả quy trình cho khớp 4 bước (tôn trọng chỉnh sửa tay: chỉ đổi khi đang giữ tên/mô tả cũ)
UPDATE hsba_workflows
SET name = 'Quy trình mặc định (Người đề nghị → KHTH → Bảo hiểm → Tài chính)',
    description = 'Bốn bước ký xác nhận điện tử: người đề nghị tạo và ký, TB.KHTH duyệt, Tr.BP bảo hiểm xác nhận, tài chính xác nhận đã hủy thanh toán.'
WHERE code = 'MAC_DINH'
  AND name LIKE 'Quy trình mặc định (Người đề nghị → KHTH → Tài chính)%';

-- 6) Phiếu đang chờ TÀI CHÍNH (chưa kết thúc) → lùi về chờ BẢO HIỂM
UPDATE hsba_requests r
SET pending_step_key = 'BAOHIEM',
    current_step = 2,
    status = 'CHO_BAOHIEM',
    updated_at = now()
FROM hsba_workflows w
WHERE r.workflow_id = w.id
  AND w.code = 'MAC_DINH'
  AND r.pending_step_key = 'TAICHINH'
  AND r.status NOT IN ('HOAN_TAT', 'DA_HUY');
