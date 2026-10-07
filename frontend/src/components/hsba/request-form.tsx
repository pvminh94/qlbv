'use client';

import { Select, Input, Label, Textarea } from '@/components/ui/input';

export interface DeptOption {
  id: number;
  name: string;
  level: number;
}

export interface UserOption {
  id: number;
  fullName: string;
  username: string;
  title: string | null;
  departmentId: number | null;
}

export interface WorkflowOption {
  id: number;
  code: string;
  name: string;
  isDefault: boolean;
  departmentId: number | null;
  steps: { key: string; name: string; title: string; kind: string }[];
}

export interface RequestFormValue {
  requesterId?: number | string;
  requesterName?: string;
  requesterTitle?: string;
  departmentId?: number | string | null;
  departmentName?: string;
  priority?: string;
  workflowId?: number | null;
  patientName?: string;
  patientBirthYear?: string;
  patientGender?: string;
  maKcb?: string;
  maTheBhyt?: string;
  ngayVaoVien?: string;
  ngayRaVien?: string;
  doiTuong?: string;
  reason?: string;
  content?: string;
  amount?: string;
  attachmentsNote?: string;
}

/**
 * Biểu mẫu phiếu đề nghị sửa HSBA — dùng chung cho trang tạo mới và hộp thoại sửa nội dung
 * khi phiếu bị trả lại.
 */
/** Thông báo lỗi theo trường của biểu mẫu tạo/sửa phiếu (rỗng = không lỗi) */
export type RequestFormErrors = Partial<
  Record<'requesterId' | 'patientName' | 'reason' | 'content', string>
>;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[11px] font-medium text-[var(--destructive,#b91c1c)]">{message}</p>;
}

export function HsbaRequestForm({
  value,
  onChange,
  users,
  departments,
  workflows,
  showWorkflow = true,
  errors,
}: {
  value: RequestFormValue;
  onChange: (next: RequestFormValue) => void;
  users?: UserOption[];
  departments?: DeptOption[];
  workflows?: WorkflowOption[];
  showWorkflow?: boolean;
  errors?: RequestFormErrors;
}) {
  const set = <K extends keyof RequestFormValue>(key: K, next: RequestFormValue[K]): void =>
    onChange({ ...value, [key]: next });

  const selectedRequester = users?.find((u) => u.id === Number(value.requesterId));

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          1. Người đề nghị
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="requesterId">Tài khoản ký đề nghị *</Label>
            <Select
              id="requesterId"
              value={String(value.requesterId ?? '')}
              onChange={(e) => {
                const u = users?.find((x) => x.id === Number(e.target.value));
                onChange({
                  ...value,
                  requesterId: e.target.value ? Number(e.target.value) : '',
                  requesterName: u?.fullName ?? value.requesterName,
                  requesterTitle: u?.title ?? '',
                  departmentId: u?.departmentId ?? value.departmentId,
                  departmentName: departments?.find((d) => d.id === u?.departmentId)?.name ?? value.departmentName,
                });
              }}
            >
              <option value="">— Chọn người đề nghị —</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.username})
                </option>
              ))}
            </Select>
            <FieldError message={errors?.requesterId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="requesterTitle">Chức danh</Label>
            <Input id="requesterTitle" value={value.requesterTitle ?? ''} onChange={(e) => set('requesterTitle', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="departmentId">Khoa đề nghị</Label>
            <Select
              id="departmentId"
              value={String(value.departmentId ?? '')}
              onChange={(e) => {
                const d = departments?.find((x) => x.id === Number(e.target.value));
                onChange({
                  ...value,
                  departmentId: e.target.value ? Number(e.target.value) : null,
                  departmentName: d?.name ?? '',
                });
              }}
            >
              <option value="">— Chọn khoa —</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {'— '.repeat(Math.max(0, d.level - 1))}
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priority">Mức ưu tiên</Label>
            <Select id="priority" value={value.priority ?? 'NORMAL'} onChange={(e) => set('priority', e.target.value)}>
              <option value="LOW">Thấp</option>
              <option value="NORMAL">Bình thường</option>
              <option value="HIGH">Ưu tiên</option>
              <option value="URGENT">Khẩn cấp</option>
            </Select>
          </div>
          {showWorkflow && workflows ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="workflowId">Quy trình ký</Label>
              <Select
                id="workflowId"
                value={String(value.workflowId ?? '')}
                onChange={(e) => set('workflowId', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— Tự chọn theo khoa (khuyến nghị) —</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.isDefault ? ' (mặc định)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          2. Người bệnh
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="patientName">Họ và tên người bệnh *</Label>
            <Input
              id="patientName"
              value={value.patientName ?? ''}
              onChange={(e) => set('patientName', e.target.value)}
              required
              aria-invalid={!!errors?.patientName}
              className={errors?.patientName ? 'border-[var(--destructive,#b91c1c)]' : undefined}
            />
            <FieldError message={errors?.patientName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="patientGender">Giới tính</Label>
            <Select id="patientGender" value={value.patientGender ?? ''} onChange={(e) => set('patientGender', e.target.value)}>
              <option value="">—</option>
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
              <option value="Khác">Khác</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="patientBirthYear">Năm sinh</Label>
            <Input id="patientBirthYear" value={value.patientBirthYear ?? ''} onChange={(e) => set('patientBirthYear', e.target.value)} placeholder="1985" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maKcb">Mã KCB / mã hồ sơ</Label>
            <Input id="maKcb" value={value.maKcb ?? ''} onChange={(e) => set('maKcb', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maTheBhyt">Mã thẻ BHYT</Label>
            <Input id="maTheBhyt" value={value.maTheBhyt ?? ''} onChange={(e) => set('maTheBhyt', e.target.value)} placeholder="DN4 79 1234567890" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ngayVaoVien">Ngày vào viện</Label>
            <Input id="ngayVaoVien" type="date" value={value.ngayVaoVien ?? ''} onChange={(e) => set('ngayVaoVien', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ngayRaVien">Ngày ra viện</Label>
            <Input id="ngayRaVien" type="date" value={value.ngayRaVien ?? ''} onChange={(e) => set('ngayRaVien', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doiTuong">Đối tượng</Label>
            <Select id="doiTuong" value={value.doiTuong ?? 'BHYT'} onChange={(e) => set('doiTuong', e.target.value)}>
              <option value="BHYT">BHYT</option>
              <option value="Thu phí">Thu phí</option>
              <option value="Miễn">Miễn</option>
              <option value="Khác">Khác</option>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          3. Nội dung đề nghị sửa
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="reason">Lý do sai sót *</Label>
          <Textarea
            id="reason"
            rows={3}
            value={value.reason ?? ''}
            aria-invalid={!!errors?.reason}
            className={errors?.reason ? 'border-[var(--destructive,#b91c1c)]' : undefined}
            onChange={(e) => set('reason', e.target.value)}
            placeholder="Ví dụ: Nhập sai ngày ra viện do hồ sơ giấy chưa khớp với phần mềm HIS…"
          />
          <FieldError message={errors?.reason} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="content">Nội dung cần sửa trong HSBA điện tử *</Label>
          <Textarea
            id="content"
            rows={4}
            value={value.content ?? ''}
            aria-invalid={!!errors?.content}
            className={errors?.content ? 'border-[var(--destructive,#b91c1c)]' : undefined}
            onChange={(e) => set('content', e.target.value)}
            placeholder="Ví dụ: Sửa ngày ra viện từ 12/09/2026 thành 15/09/2026; điều chỉnh lại chẩn đoán…"
          />
          <FieldError message={errors?.content} />
        </div>
              </section>

      {selectedRequester ? (
        <p className="rounded-lg border bg-[var(--muted)]/50 p-3 text-[11px] text-[var(--muted-foreground)]">
          Người đề nghị <b className="text-[var(--foreground)]">{selectedRequester.fullName}</b> chịu trách nhiệm về nội dung ký số ở bước 1.
          Các bước tiếp theo do người có thẩm quyền theo quy trình đang áp dụng xác nhận.
        </p>
      ) : null}
    </div>
  );
}
