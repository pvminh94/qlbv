'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Save, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  HsbaRequestForm,
  type DeptOption,
  type RequestFormValue,
  type UserOption,
  type WorkflowOption,
} from '@/components/hsba/request-form';
import { PageHeader } from '@/components/shared/page-header';
import { Badge, Card, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/input';
import { toList } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Paginated } from '@/types/api';

interface DuplicateRow {
  id: number;
  code: string;
  status: string;
  patientName: string;
  maKcb: string | null;
  requesterName: string;
  departmentName: string | null;
  createdAt: string;
}

/** Khoá nháp cục bộ — vô tình đổi trang cũng không mất biểu mẫu đang điền */
const DRAFT_KEY = 'hsba-draft';
/** Nháp chỉ được lưu nếu ngườI dùng đã gõ nội dung chính */
function hasDraftContent(form: RequestFormValue): boolean {
  return !!(form.patientName || form.maKcb || form.maTheBhyt || form.reason || form.content);
}

/** Tạo phiếu đề nghị sửa hồ sơ bệnh án — có thể gửi ký ngay hoặc lưu nháp. */
export default function CreateHsbaPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [form, setForm] = useState<RequestFormValue>({
    patientGender: 'Nữ',
    doiTuong: 'BHYT',
    priority: 'NORMAL',
  });
  const [signNow, setSignNow] = useState(true);
  /** Khóa kiểm tra trùng sau debounce — chống tạo 2 phiếu cho cùng một hồ sơ */
  const [dupKey, setDupKey] = useState({ maKcb: '', maTheBhyt: '' });
  /** Hỏi lại ngườI dùng khi server báo trùng phiếu (409) */
  const [forceAsk, setForceAsk] = useState(false);
  /** Lỗi bắt buộc hiển ngay tại trường tương ứng (không chỉ toast) */
  const [fieldErrors, setFieldErrors] = useState<{} & Partial<Record<'requesterId' | 'patientName' | 'reason' | 'content', string>>>({});
  const [draftRestored, setDraftRestored] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Khôi phục nháp một lần lúc mở trang
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as RequestFormValue;
        if (draft && typeof draft === 'object' && hasDraftContent(draft)) {
          setForm((s) => ({ ...s, ...draft }));
          setDraftRestored(true);
        }
      }
    } catch {
      /* nháp hỏng thì bỏ qua */
    }
    // chỉ chạy một lần lúc mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự lưu nháp sau 600ms ngừng gõ
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        if (hasDraftContent(form)) localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      } catch {
        /* bỏ qua */
      }
    }, 600);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [form]);

  // Debounce khoá tra cứu trùng
  useEffect(() => {
    const t = setTimeout(() => {
      setDupKey({ maKcb: (form.maKcb ?? '').trim(), maTheBhyt: (form.maTheBhyt ?? '').trim() });
    }, 450);
    return () => clearTimeout(t);
  }, [form.maKcb, form.maTheBhyt]);

  useEffect(() => {
    if (!user) return;
    setForm((s) =>
      s.requesterId
        ? s
        : {
            ...s,
            requesterId: user.id,
            requesterName: user.fullName,
            requesterTitle: user.title ?? '',
            departmentId: user.departmentId ?? null,
            departmentName: user.departmentName ?? '',
          },
    );
  }, [user]);

  const { data: duplicates } = useQuery({
    queryKey: ['hsba-duplicates-suggest', dupKey.maKcb, dupKey.maTheBhyt],
    queryFn: (): Promise<DuplicateRow[]> => {
      const p = new URLSearchParams();
      if (dupKey.maKcb) p.set('maKcb', dupKey.maKcb);
      if (dupKey.maTheBhyt) p.set('maTheBhyt', dupKey.maTheBhyt);
      return apiFetch<DuplicateRow[]>(`/hsba/requests/duplicates?${p.toString()}`);
    },
    enabled: dupKey.maKcb.length >= 3 || dupKey.maTheBhyt.length >= 6,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments-options'],
    queryFn: () => apiFetch<DeptOption[]>('/departments/options'),
  });

  const { data: users, isLoading: loadingUsers } = useQuery({
    queryKey: ['users-options'],
    queryFn: () => apiFetch<Paginated<UserOption>>('/users?pageSize=200&activeOnly=true'),
  });

  const { data: workflows } = useQuery({
    queryKey: ['hsba-workflows'],
    queryFn: () => apiFetch<unknown>('/hsba/workflows?pageSize=200').then((d) => toList<WorkflowOption>(d)),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<{ id: number; code: string }>('/hsba/requests', { method: 'POST', body: payload }),
    onSuccess: (result) => {
      localStorage.removeItem(DRAFT_KEY);
      setDraftRestored(false);
      toast.success(`Đã tạo phiếu ${result.code}`);
      router.push(`/ho-so-benh-an/${result.id}`);
    },
    onError: (err) => {
      // 409 = máy chủ thấy phiếu đang mở cho cùng hồ sơ — hỏi ý ngườI dùng
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 409) setForceAsk(true);
      else toast.error(e.message);
    },
  });

  const submit = (sign: boolean, force = false): void => {
    const errs: typeof fieldErrors = {};
    if (!form.requesterId) errs.requesterId = 'Vui lòng chọn tài khoản đứng tên ký đề nghị';
    if (!(form.patientName ?? '').trim()) errs.patientName = 'Vui lòng nhập họ tên ngườI bệnh';
    if (!(form.reason ?? '').trim()) errs.reason = 'Vui lòng nhập lý do sai sót';
    if (!(form.content ?? '').trim()) errs.content = 'Vui lòng nhập nội dung cần sửa';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Biểu mẫu chưa đủ thông tin — kiểm tra các mục đánh dấu đỏ');
      return;
    }
    setForceAsk(false);
    create.mutate({ ...form, signNow: sign, ...(force ? { force: true } : {}) });
  };

  const activeWorkflow =
    (workflows ?? []).find((w) => w.id === Number(form.workflowId)) ??
    (workflows ?? []).find((w) => w.isDefault) ??
    (workflows ?? [])[0];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <Link href="/ho-so-benh-an" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" /> Danh sách phiếu
          </Link>
        }
        title="Tạo phiếu đề nghị sửa HSBA"
        description="Ghi rõ lý do sai sót và nội dung cần sửa để Ban KHTH và Tài chính xác nhận"
        actions={
          <>
            <Button variant="outline" loading={create.isPending} onClick={() => submit(false)}>
              <Save /> Lưu nháp
            </Button>
            <Button loading={create.isPending} onClick={() => submit(true)}>
              <Send /> Tạo và gửi ký
            </Button>
          </>
        }
      />

      {draftRestored ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--warning,#b45309)]/40 bg-[var(--warning,#b45309)]/10 px-4 py-2.5 text-sm"
          role="status"
        >
          <Badge tone="warning">Nháp</Badge>
          <span>Đã khôi phục bản nháp được lưu tự động trước đó — nội dung đang lưu nháp tự động trên máy này.</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              localStorage.removeItem(DRAFT_KEY);
              setDraftRestored(false);
              toast.success('Đã xoá nháp đã lưu');
            }}
          >
            Xoá nháp
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-4">
          {loadingUsers ? (
            <Skeleton className="h-64" />
          ) : (
            <HsbaRequestForm
              value={form}
              onChange={(next) => {
                setForm(next);
                if (Object.keys(fieldErrors).length > 0) setFieldErrors({});
              }}
              errors={fieldErrors}
              users={users?.items}
              departments={departments}
              workflows={workflows}
            />
          )}
          {(duplicates?.length ?? 0) > 0 ? (
            <div className="mt-4 rounded-xl border border-[var(--warning,#b45309)]/50 bg-[var(--warning,#b45309)]/10 p-3" role="alert">
              <div className="text-sm font-semibold text-[var(--warning,#b45309)]">
                Phát hiện {duplicates!.length} phiếu đang mở trùng mã KCB / mã thẻ BHYT
              </div>
              <ul className="mt-2 space-y-1.5">
                {duplicates!.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Link href={`/ho-so-benh-an/${d.id}`} className="font-mono font-semibold text-[var(--primary)] hover:underline">
                      {d.code}
                    </Link>
                    <span>{d.patientName}</span>
                    <span className="text-[var(--muted-foreground)]">· {d.departmentName || '—'}</span>
                    <Badge tone="muted">{d.status}</Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                Kiểm tra các phiếu trên trước khi tạo — nếu đúng thực sự cần phiếu mới, hệ thống sẽ hỏi xác nhận một lần nữa khi lưu.
              </p>
            </div>
          ) : null}

          <label className="mt-4 flex items-center gap-2 border-t pt-4 text-sm">
            <Switch checked={signNow} onCheckedChange={setSignNow} />
            Ký xác nhận ngay sau khi tạo (nếu bạn chính là người đề nghị)
          </label>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">Quy trình ký áp dụng</div>
            <div className="p-4">
              {!activeWorkflow ? (
                <p className="text-sm text-[var(--muted-foreground)]">Chưa có quy trình ký nào được cấu hình.</p>
              ) : (
                <>
                  <div className="text-sm font-medium">{activeWorkflow.name}</div>
                  <ol className="mt-2 space-y-2">
                    {activeWorkflow.steps.map((step, index) => (
                      <li key={step.key} className="flex items-start gap-2">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-semibold">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{step.name}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)]">
                            {step.title} ·{' '}
                            {step.kind === 'requester'
                              ? 'người đề nghị'
                              : step.kind === 'dept_head'
                                ? 'trưởng khoa'
                                : step.kind === 'creator'
                                  ? 'người tạo phiếu'
                                  : 'theo vai trò'}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
              <ClipboardList className="size-4" /> Lưu ý khi lập phiếu
            </div>
            <ul className="space-y-2 p-4 text-[12px] text-[var(--muted-foreground)]">
              <li>• Nội dung đề nghị sửa cần ghi rõ “từ … thành …” để KHTH đối chiếu nhanh.</li>
              <li>• Số tiền liên quan giúp Tài chính xác định giao dịch BHYT cần hủy.</li>
              <li>• Sau khi ký bước 1, nếu bị trả lại bạn có thể sửa nội dung và gửi lại.</li>
            </ul>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={forceAsk}
        title="Phiếu trùng — vẫn tạo?"
        message={
          <>
            Máy chủ phát hiện đã có phiếu <b>đang mở</b> với cùng mã KCB / mã thẻ BHYT của hồ sơ này.
            Chỉ chọn <b>Vẫn tạo phiếu</b> nếu đây là nhu cầu mới sau khi đã rà các phiếu cũ.
          </>
        }
        confirmText="Vẫn tạo phiếu"
        loading={create.isPending}
        onConfirm={() => submit(signNow, true)}
        onClose={() => setForceAsk(false)}
      />
    </div>
  );
}
