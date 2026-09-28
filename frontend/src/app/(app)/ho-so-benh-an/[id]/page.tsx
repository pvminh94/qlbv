'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  FileDown,
  History,
  PenLine,
  Printer,
  Send,
  ShieldAlert,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { AttachmentsPanel, CommentsPanel } from '@/components/hsba/side-panels';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Label, Textarea } from '@/components/ui/input';
import {
  HsbaRequestForm,
  type DeptOption,
  type RequestFormValue,
  type UserOption,
  type WorkflowOption,
} from '@/components/hsba/request-form';
import { apiFetch, ensureFileSession, openFileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, toList } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import type { Paginated } from '@/types/api';

interface Signature {
  id: number;
  stepKey: string;
  stepName: string;
  username: string;
  fullName: string;
  title: string;
  contentHash: string;
  note: string | null;
  ip: string;
  signedAt: string;
}

interface TimelineStep {
  index: number;
  key: string;
  name: string;
  title: string;
  kind: string;
  allowReturn: boolean;
  requireNote: boolean;
  state: 'SIGNED' | 'PENDING' | 'SKIPPED' | 'WAITING';
  canSignCurrent: boolean;
  signature: Signature | null;
}

interface Detail {
  id: number;
  code: string;
  status: string;
  statusLabel: string;
  currentStep: number;
  pendingStepKey: string | null;
  patientName: string;
  patientBirthYear: string | null;
  patientGender: string | null;
  patientCode: string | null;
  patientAddress: string | null;
  maKcb: string | null;
  maTheBhyt: string | null;
  ngayVaoVien: string | null;
  ngayRaVien: string | null;
  doiTuong: string | null;
  requesterId: number;
  requesterName: string;
  requesterTitle: string | null;
  workflowId: number | null;
  departmentId: number | null;
  departmentName: string | null;
  reason: string;
  content: string;
  amount: string | null;
  attachmentsNote: string | null;
  internalNote: string | null;
  priority: string;
  returnCount: number;
  returnReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  workflow: { id: number; code: string; name: string } | null;
  timeline: TimelineStep[];
  logs: { id: number; action: string; description: string; fromStatus: string | null; toStatus: string | null; username: string; createdAt: string }[];
  integrity: { stepKey: string; valid: boolean }[];
}

export default function HsbaDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useAuth((s) => s.can);

  const [signTarget, setSignTarget] = useState<TimelineStep | null>(null);
  const [note, setNote] = useState('');
  const [returnTarget, setReturnTarget] = useState<TimelineStep | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<RequestFormValue>({});

  const { data, isLoading } = useQuery({
    queryKey: ['hsba-detail', id],
    enabled: Number.isFinite(id),
    queryFn: () => apiFetch<Detail>(`/hsba/requests/${id}`),
  });

  const { data: userOptions } = useQuery({
    queryKey: ['users-options'],
    enabled: editOpen,
    queryFn: () => apiFetch<Paginated<UserOption>>('/users?pageSize=200&activeOnly=true'),
  });

  const { data: deptOptions } = useQuery({
    queryKey: ['departments-options'],
    enabled: editOpen,
    queryFn: () => apiFetch<DeptOption[]>('/departments/options'),
  });

  const { data: workflowOptions } = useQuery({
    queryKey: ['hsba-workflows'],
    enabled: editOpen,
    queryFn: () => apiFetch<unknown>('/hsba/workflows?pageSize=200').then((d) => toList<WorkflowOption>(d)),
  });

  const updateRequest = useMutation({
    mutationFn: (payload: RequestFormValue) => apiFetch(`/hsba/requests/${id}`, { method: 'PUT', body: payload }),
    onSuccess: async () => {
      toast.success('Đã cập nhật nội dung phiếu');
      setEditOpen(false);
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['hsba-detail', id] });
    await queryClient.invalidateQueries({ queryKey: ['hsba-requests'] });
  };

  const sign = useMutation({
    mutationFn: (payload: { stepKey: string; note?: string }) =>
      apiFetch(`/hsba/requests/${id}/sign`, { method: 'POST', body: payload }),
    onSuccess: async () => {
      toast.success('Đã ký xác nhận');
      setSignTarget(null);
      setNote('');
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const returnRequest = useMutation({
    mutationFn: (payload: { stepKey: string; reason: string }) =>
      apiFetch(`/hsba/requests/${id}/return`, { method: 'POST', body: { reason: payload.reason } }),
    onSuccess: async () => {
      toast.success('Đã trả lại phiếu cho người đề nghị');
      setReturnTarget(null);
      setReturnReason('');
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const cancel = useMutation({
    mutationFn: () => apiFetch(`/hsba/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Đã huỷ phiếu');
      setConfirmCancel(false);
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const pending = data.timeline.find((s) => s.state === 'PENDING');
  const finished = ['HOAN_TAT', 'DA_HUY'].includes(data.status);
  const editable = ['CHO_DE_NGHI', 'TRA_LAI'].includes(data.status);

  const integrityOk = data.integrity.every((i) => i.valid);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/ho-so-benh-an" className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:underline">
            <ArrowLeft className="size-3" /> Danh sách phiếu
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <span className="font-mono">{data.code}</span>
            <StatusBadge status={data.status} label={data.statusLabel} />
            {integrityOk ? (
              <Badge tone="success">
                <ShieldCheck className="mr-1 size-3" /> Nội dung toàn vẹn
              </Badge>
            ) : (
              <Badge tone="danger">
                <ShieldAlert className="mr-1 size-3" /> Nội dung đã thay đổi sau khi ký
              </Badge>
            )}
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {data.patientName} · {data.departmentName ?? '—'} · tạo {formatDateTime(data.createdAt)}
            {data.completedAt ? ` · hoàn tất ${formatDateTime(data.completedAt)}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can('hsba.request.print') ? (
            <>
              <Button variant="outline" onClick={() => void ensureFileSession().then(() => setShowPdf(true))}>
                <Printer /> Xem bản in
              </Button>
              <a
                href={`/api/hsba/requests/${data.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openFileUrl(`/api/hsba/requests/${data.id}/pdf`);
                }}
                className="inline-flex h-9.5 items-center gap-2 rounded-lg border bg-[var(--card)] px-4 text-sm font-medium hover:bg-[var(--accent)]"
              >
                <FileDown className="size-4" /> Tải PDF
              </a>
            </>
          ) : null}
          {data.status === 'TRA_LAI' && can('hsba.request.update') ? (
            <Button
              onClick={() => {
                setEditForm({
                  requesterId: data.requesterId,
                  requesterName: data.requesterName,
                  requesterTitle: data.requesterTitle ?? '',
                  departmentId: data.departmentId,
                  departmentName: data.departmentName ?? '',
                  priority: data.priority,
                  workflowId: data.workflowId,
                  patientName: data.patientName,
                  patientBirthYear: data.patientBirthYear ?? '',
                  patientGender: data.patientGender ?? '',
                  maKcb: data.maKcb ?? '',
                  maTheBhyt: data.maTheBhyt ?? '',
                  ngayVaoVien: data.ngayVaoVien ?? '',
                  ngayRaVien: data.ngayRaVien ?? '',
                  doiTuong: data.doiTuong ?? '',
                  reason: data.reason,
                  content: data.content,
                  amount: data.amount ?? '',
                  attachmentsNote: data.attachmentsNote ?? '',
                });
                setEditOpen(true);
              }}
            >
              <PenLine /> Sửa & gửi lại
            </Button>
          ) : null}
          {editable && data.status !== 'TRA_LAI' && can('hsba.request.update') ? (
            <Button
              variant="outline"
              onClick={() => {
                setEditForm({
                  requesterId: data.requesterId,
                  requesterName: data.requesterName,
                  requesterTitle: data.requesterTitle ?? '',
                  departmentId: data.departmentId,
                  departmentName: data.departmentName ?? '',
                  priority: data.priority,
                  workflowId: data.workflowId,
                  patientName: data.patientName,
                  patientBirthYear: data.patientBirthYear ?? '',
                  patientGender: data.patientGender ?? '',
                  maKcb: data.maKcb ?? '',
                  maTheBhyt: data.maTheBhyt ?? '',
                  ngayVaoVien: data.ngayVaoVien ?? '',
                  ngayRaVien: data.ngayRaVien ?? '',
                  doiTuong: data.doiTuong ?? '',
                  reason: data.reason,
                  content: data.content,
                  amount: data.amount ?? '',
                  attachmentsNote: data.attachmentsNote ?? '',
                });
                setEditOpen(true);
              }}
            >
              <PenLine /> Sửa nội dung
            </Button>
          ) : null}
          {!finished && can('hsba.request.cancel') ? (
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              <Ban /> Huỷ phiếu
            </Button>
          ) : null}
        </div>
      </div>

      {/* Stepper tiến trình ngang: toàn cảnh vị trí của phiếu trong quy trình */}
      <Card>
        <div className="flex items-stretch overflow-x-auto p-3">
          {data.timeline.map((step, idx) => (
            <Fragment key={step.key}>
              {idx > 0 ? (
                <div
                  className={cn(
                    'mt-3 h-0.5 min-w-6 flex-1 self-start rounded-full',
                    step.state === 'SIGNED' ? 'bg-emerald-500' : 'bg-[var(--border,var(--muted))]',
                  )}
                />
              ) : null}
              <div className="flex min-w-[7.5rem] flex-col items-center gap-1 px-1 text-center">
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold',
                    step.state === 'SIGNED' && 'border-emerald-500 bg-emerald-500 text-white',
                    step.state === 'PENDING' && 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]',
                    (step.state === 'WAITING' || step.state === 'SKIPPED') &&
                      'border-[var(--muted-foreground)]/30 text-[var(--muted-foreground)]',
                  )}
                >
                  {step.state === 'SIGNED' ? <CheckCircle2 className="size-4" /> : step.index + 1}
                </span>
                <span className={cn('max-w-28 text-[11px] leading-tight', step.state === 'PENDING' ? 'font-semibold text-[var(--primary)]' : 'text-[var(--muted-foreground)]')}>
                  {step.name}
                </span>
                {step.signature ? (
                  <span className="text-[9px] text-[var(--muted-foreground)]">{formatDateTime(step.signature.signedAt)}</span>
                ) : null}
              </div>
            </Fragment>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">Thông tin người bệnh</div>
            <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Họ và tên', data.patientName],
                ['Năm sinh', data.patientBirthYear],
                ['Giới tính', data.patientGender],
                ['Mã KCB', data.maKcb],
                ['Mã thẻ BHYT', data.maTheBhyt],
                ['Đối tượng', data.doiTuong],
                ['Ngày vào viện', data.ngayVaoVien],
                ['Ngày ra viện', data.ngayRaVien],
                ['Số tiền liên quan', data.amount ? `${Number(data.amount).toLocaleString('vi-VN')} đ` : null],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
                  <dd className="text-sm">{value ? String(value) : '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">Nội dung đề nghị sửa</div>
            <div className="space-y-4 p-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Lý do sai sót</div>
                <p className="whitespace-pre-wrap text-sm">{data.reason}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  Nội dung cần sửa trong HSBA điện tử
                </div>
                <p className="whitespace-pre-wrap text-sm">{data.content}</p>
              </div>
              {data.attachmentsNote ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Tài liệu kèm theo</div>
                  <p className="text-sm">{data.attachmentsNote}</p>
                </div>
              ) : null}
              {data.returnCount > 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
                  <div className="font-medium">Phiếu đã bị trả lại {data.returnCount} lần</div>
                  <div className="text-xs">Lý do gần nhất: {data.returnReason ?? '—'}</div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
              <History className="size-4" /> Nhật ký xử lý
            </div>
            {data.logs.length === 0 ? (
              <EmptyState title="Chưa có ghi nhận nào" />
            ) : (
              <ul className="divide-y">
                {data.logs.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-4 py-2.5">
                    <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{log.description}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">
                        {log.username} · {formatDateTime(log.createdAt)}
                        {log.fromStatus && log.toStatus ? ` · ${log.fromStatus} → ${log.toStatus}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">Tiến trình ký điện tử</div>
            <div className="space-y-3 p-4">
              {data.timeline.map((step) => {
                const sig = step.signature;
                const integrity = data.integrity.find((i) => i.stepKey === step.key);
                return (
                  <div
                    key={step.key}
                    className={cn(
                      'rounded-xl border p-3',
                      step.state === 'PENDING' && 'border-[var(--primary)] bg-[var(--accent)]/40',
                      step.state === 'SIGNED' && 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--muted)] text-[10px]">
                            {step.index + 1}
                          </span>
                          {step.name}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">{step.title}</div>
                      </div>
                      {step.state === 'SIGNED' ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      ) : step.state === 'PENDING' ? (
                        <Clock className="size-4 shrink-0 text-[var(--primary)]" />
                      ) : null}
                    </div>

                    {sig ? (
                      <div className="mt-2 space-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                        <div className="text-sm text-[var(--foreground)]">{sig.fullName}</div>
                        <div>
                          {sig.title || '—'} · {formatDateTime(sig.signedAt)}
                        </div>
                        <div>IP: {sig.ip || '—'}</div>
                        <div className="break-all font-mono">Mã xác thực: {sig.contentHash.slice(0, 24)}…</div>
                        {!integrity?.valid ? (
                          <div className="font-medium text-[var(--danger)]">Nội dung đã thay đổi sau khi ký!</div>
                        ) : null}
                      </div>
                    ) : step.state === 'PENDING' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {step.canSignCurrent ? (
                          <Button size="sm" onClick={() => setSignTarget(step)}>
                            {data.returnCount > 0 && step.state === 'PENDING' ? (
                              <>
                                <Send /> Gửi lại phiếu
                              </>
                            ) : (
                              <>
                                <CheckCircle2 /> Ký bước này
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="text-[11px] text-[var(--muted-foreground)]">
                            Đang chờ người có thẩm quyền xử lý
                          </span>
                        )}
                        {step.allowReturn && can('hsba.request.return') ? (
                          <Button size="sm" variant="outline" onClick={() => setReturnTarget(step)}>
                            <Undo2 /> Trả lại
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">Chưa tới bước này</div>
                    )}

                    {sig?.note ? <p className="mt-2 text-xs italic">“{sig.note}”</p> : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">Thông tin chung</div>
            <dl className="space-y-2 p-4 text-sm">
              {[
                ['Quy trình', data.workflow?.name],
                ['Người đề nghị', `${data.requesterName}${data.requesterTitle ? ` — ${data.requesterTitle}` : ''}`],
                ['Khoa', data.departmentName],
                ['Mức ưu tiên', data.priority],
                ['Cập nhật gần nhất', formatDateTime(data.updatedAt)],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-start justify-between gap-3">
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
                  <dd className="text-right">{value ? String(value) : '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CommentsPanel requestId={id} />
          </Card>
        </div>
      </div>

      <Card>
        <AttachmentsPanel requestId={id} finished={finished} />
      </Card>

      {/* Ký xác nhận */}
      <Dialog
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        title={`Ký xác nhận: ${signTarget?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSignTarget(null)}>
              Huỷ
            </Button>
            <Button
              loading={sign.isPending}
              onClick={() => signTarget && sign.mutate({ stepKey: signTarget.key, note: note.trim() || undefined })}
            >
              <CheckCircle2 /> Xác nhận ký
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border bg-[var(--muted)]/50 p-3 text-xs">{signTarget?.title}</div>
          <div className="space-y-1.5">
            <Label htmlFor="sign-note">
              Ý kiến {signTarget?.requireNote ? '(bắt buộc)' : '(không bắt buộc)'}
            </Label>
            <Textarea id="sign-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Hệ thống sẽ băm nội dung phiếu để tạo mã xác thực cho chữ ký này. Sau khi ký, mọi thay đổi nội dung đều bị
            phát hiện.
          </p>
        </div>
      </Dialog>

      {/* Trả lại */}
      <Dialog
        open={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        title="Trả lại phiếu"
        description="Phiếu sẽ quay về trạng thái chờ người đề nghị xác nhận"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setReturnTarget(null)}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              disabled={!returnReason.trim()}
              loading={returnRequest.isPending}
              onClick={() => returnTarget && returnRequest.mutate({ stepKey: returnTarget.key, reason: returnReason.trim() })}
            >
              <Undo2 /> Trả lại phiếu
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="return-reason">Lý do trả lại *</Label>
          <Textarea id="return-reason" rows={3} value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmCancel}
        title="Huỷ phiếu đề nghị"
        message={<>Huỷ phiếu <b>{data.code}</b>? Phiếu sẽ không tiếp tục quy trình ký và không thể khôi phục.</>}
        confirmText="Huỷ phiếu"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setConfirmCancel(false)}
      />

      {/* Sửa nội dung phiếu (khi chưa hoàn tất / bị trả lại) */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        size="xl"
        title={`Sửa nội dung phiếu: ${data.code}`}
        description="Chỉnh sửa rồi bấm Lưu; nếu phiếu bị trả lại, ký ở bước đang chờ để gửi lại"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Huỷ
            </Button>
            <Button loading={updateRequest.isPending} onClick={() => updateRequest.mutate(editForm)}>
              <PenLine /> Lưu thay đổi
            </Button>
          </>
        }
      >
        <HsbaRequestForm
          value={editForm}
          onChange={setEditForm}
          users={userOptions?.items}
          departments={deptOptions}
          workflows={workflowOptions}
        />
      </Dialog>

      {/* Xem trước bản in */}
      <Dialog open={showPdf} onClose={() => setShowPdf(false)} size="xl" title={`Bản in: ${data.code}`} description="Kết xuất từ mẫu in đang ban hành">
        <iframe title="Bản in phiếu" src={`/api/hsba/requests/${data.id}/pdf#toolbar=1`} className="h-[70vh] w-full rounded-lg border" />
      </Dialog>
    </div>
  );
}
