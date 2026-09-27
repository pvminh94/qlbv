'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, FileText, Pencil, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AssetStatus, AssetSubnav, Field, TxStatus } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { apiFetch, openFileUrl } from '@/lib/api';
import { ASSET_CONDITION, ASSET_STATUS, money, type TxTypeMeta } from '@/lib/assets';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

interface Item {
  id: number; assetId: number; amount: number; condition: string; note: string; code: string; name: string; model: string; serialNumber: string; unit: string;
  status: string; originalCost: number; bookValue: number; departmentName: string | null; custodianName: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}
interface Tx {
  id: number; code: string; type: string; typeLabel: string; typeMeta: TxTypeMeta; status: string; txDate: string; reason: string; decisionNo: string; note: string;
  delivererName: string; receiverName: string; toCustodianName: string; amount: number; rejectReason: string; approvedAt: string | null; submittedAt?: string | null; createdAt: string;
  fromDepartmentName: string | null; toDepartmentName: string | null; toLocationName: string | null; toCustodianFullName: string | null; supplierName: string | null;
  createdByName: string | null; approvedByName: string | null;
  items: Item[];
  can: { edit: boolean; submit: boolean; approve: boolean; reject: boolean; cancel: boolean };
}

const FIELD_LABEL: Record<string, string> = {
  status: 'Trạng thái', departmentId: 'Khoa', locationId: 'Vị trí', custodianId: 'Người giữ', custodianName: 'Người giữ', condition: 'Tình trạng',
  originalCost: 'Nguyên giá', lastCalibrationDate: 'KĐ gần nhất', nextCalibrationDate: 'Hạn KĐ', lastMaintenanceDate: 'BD gần nhất', nextMaintenanceDate: 'Hạn BD', inUseDate: 'Ngày SD',
};
const show = (k: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'status') return ASSET_STATUS[String(v)]?.label ?? String(v);
  if (k === 'condition') return ASSET_CONDITION[String(v)] ?? String(v);
  if (k === 'originalCost') return money(v);
  return String(v);
};

export default function TxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | 'approve' | 'cancel' | 'submit'>(null);
  const [reject, setReject] = useState(false);
  const [why, setWhy] = useState('');

  const { data: t, isLoading, error } = useQuery({
    queryKey: ['asset-tx-detail', id],
    queryFn: () => apiFetch<Tx>(`/asset-transactions/${id}`),
    refetchInterval: 20_000,
  });

  const act = useMutation({
    mutationFn: (a: 'approve' | 'cancel' | 'submit' | 'reject') => apiFetch(`/asset-transactions/${id}/${a}`, { method: 'POST', body: a === 'reject' ? { reason: why } : undefined }),
    onSuccess: (_r, a) => {
      toast.success({ approve: 'Đã duyệt — tài sản đã được cập nhật', cancel: 'Đã huỷ chứng từ', submit: 'Đã gửi duyệt', reject: 'Đã từ chối chứng từ' }[a]);
      setConfirm(null);
      setReject(false);
      qc.invalidateQueries({ queryKey: ['asset-tx-detail', id] });
      qc.invalidateQueries({ queryKey: ['asset-tx'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset'] });
      qc.invalidateQueries({ queryKey: ['asset-dashboard'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !t) {
    return (
      <div className="space-y-4">
        <AssetSubnav />
        <EmptyState title="Không mở được chứng từ" description={(error as Error)?.message} />
      </div>
    );
  }
  const amountLabel = t.typeMeta?.amountLabel;
  const steps = [
    { k: 'NHAP', l: 'Lập', at: t.createdAt, by: t.createdByName },
    { k: 'CHO_DUYET', l: 'Chờ duyệt', at: t.submittedAt ?? null, by: null },
    { k: 'DA_DUYET', l: t.status === 'TU_CHOI' ? 'Từ chối' : t.status === 'DA_HUY' ? 'Đã huỷ' : 'Đã duyệt', at: t.approvedAt, by: t.approvedByName },
  ];
  const stepIdx = { NHAP: 0, CHO_DUYET: 1, DA_DUYET: 2, TU_CHOI: 2, DA_HUY: 2 }[t.status] ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/tai-san">Quản lý tài sản</Link> / <Link href="/tai-san/nghiep-vu">Chứng từ</Link> / {t.code}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t.typeLabel} <span className="font-mono text-base text-teal-700">{t.code}</span>
            <TxStatus status={t.status} />
          </span>
        }
        description={t.typeMeta?.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openFileUrl(`/api/asset-transactions/${t.id}/print`)}>
              <FileText className="size-4" /> In biên bản
            </Button>
            {t.can.edit ? (
              <Button variant="outline" onClick={() => router.push(`/tai-san/nghiep-vu/tao-moi?edit=${t.id}`)}>
                <Pencil className="size-4" /> Sửa
              </Button>
            ) : null}
            {t.can.submit ? (
              <Button variant="subtle" onClick={() => setConfirm('submit')}>
                <Send className="size-4" /> Gửi duyệt
              </Button>
            ) : null}
            {t.can.reject ? (
              <Button variant="danger" onClick={() => (setWhy(''), setReject(true))}>
                <XCircle className="size-4" /> Từ chối
              </Button>
            ) : null}
            {t.can.approve ? (
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setConfirm('approve')}>
                <CheckCircle2 className="size-4" /> Duyệt & áp dụng
              </Button>
            ) : null}
            {t.can.cancel ? (
              <Button variant="ghost" className="text-red-600" onClick={() => setConfirm('cancel')} title="Huỷ chứng từ">
                <Ban className="size-4" />
              </Button>
            ) : null}
          </div>
        }
      />
      <AssetSubnav />

      {/* Tiến trình */}
      <Card className="p-4">
        <div className="flex items-center">
          {steps.map((s, i) => {
            const done = i <= stepIdx;
            const bad = i === 2 && ['TU_CHOI', 'DA_HUY'].includes(t.status);
            return (
              <div key={s.k} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center text-center">
                  <div className={cn('grid size-8 place-items-center rounded-full text-xs font-bold', bad ? 'bg-red-600 text-white' : done ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-500')}>{i + 1}</div>
                  <div className="mt-1 text-xs font-medium">{s.l}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">
                    {done && s.at ? formatDateTime(s.at) : ''}
                    {done && s.by ? ` · ${s.by}` : ''}
                  </div>
                </div>
                {i < steps.length - 1 ? <div className={cn('mx-2 h-0.5 flex-1', i < stepIdx ? 'bg-teal-600' : 'bg-slate-200')} /> : null}
              </div>
            );
          })}
        </div>
        {t.status === 'TU_CHOI' && t.rejectReason ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Lý do từ chối: {t.rejectReason}</div> : null}
      </Card>

      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ngày chứng từ">{formatDate(t.txDate)}</Field>
        <Field label="Số quyết định">{t.decisionNo}</Field>
        <Field label="Từ khoa/phòng">{t.fromDepartmentName ?? (t.items.length ? 'Kho / nhiều khoa' : null)}</Field>
        <Field label="Đến">{[t.toDepartmentName, t.toLocationName, t.toCustodianFullName || t.toCustodianName].filter(Boolean).join(' · ')}</Field>
        <Field label="Người giao">{t.delivererName}</Field>
        <Field label="Người nhận">{t.receiverName}</Field>
        <Field label="Đơn vị thực hiện">{t.supplierName}</Field>
        <Field label={amountLabel ?? 'Số tiền'}>{Number(t.amount) ? `${money(t.amount)} đ` : null}</Field>
        <Field label="Lý do / nội dung" className="sm:col-span-2 lg:col-span-4">{t.reason}</Field>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3 text-sm font-semibold">Tài sản ({t.items.length})</div>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Tài sản</th>
                <th className="p-2">Hiện tại</th>
                <th className="p-2 text-right">Nguyên giá</th>
                {amountLabel ? <th className="p-2 text-right">{amountLabel}</th> : null}
                <th className="p-2">Tình trạng / ghi chú</th>
                {t.status === 'DA_DUYET' ? <th className="p-2">Thay đổi đã áp dụng</th> : null}
              </tr>
            </thead>
            <tbody>
              {t.items.map((i, n) => (
                <tr key={i.id} className="border-t align-top">
                  <td className="p-2 text-xs">{n + 1}</td>
                  <td className="min-w-[220px] p-2">
                    <Link href={`/tai-san/${i.assetId}`} className="font-mono text-xs font-semibold text-teal-700 hover:underline">
                      {i.code}
                    </Link>
                    <div>{i.name}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{[i.model, i.serialNumber && `S/N ${i.serialNumber}`].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="p-2 text-xs">
                    <AssetStatus status={i.status} />
                    <div className="mt-0.5 text-[var(--muted-foreground)]">{i.departmentName ?? 'Kho'}</div>
                  </td>
                  <td className="whitespace-nowrap p-2 text-right tabular-nums">{money(i.originalCost)}</td>
                  {amountLabel ? <td className="whitespace-nowrap p-2 text-right tabular-nums">{Number(i.amount) ? money(i.amount) : ''}</td> : null}
                  <td className="p-2 text-xs">{[i.condition && ASSET_CONDITION[i.condition], i.note].filter(Boolean).join(' · ')}</td>
                  {t.status === 'DA_DUYET' ? (
                    <td className="p-2 text-[11px]">
                      {Object.entries(i.after ?? {})
                        .filter(([k]) => FIELD_LABEL[k] && k !== 'custodianId')
                        .map(([k, v]) => (
                          <div key={k}>
                            <span className="text-[var(--muted-foreground)]">{FIELD_LABEL[k]}:</span> <span className="opacity-60">{show(k, i.before?.[k])}</span> → <b>{show(k, v)}</b>
                          </div>
                        ))}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="text-xs text-[var(--muted-foreground)]">
        Lập bởi {t.createdByName} lúc {formatDateTime(t.createdAt)}
        {t.approvedByName ? ` · ${t.status === 'TU_CHOI' ? 'Từ chối' : 'Duyệt'} bởi ${t.approvedByName}${t.approvedAt ? ` lúc ${formatDateTime(t.approvedAt)}` : ''}` : ''}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'approve' ? `Duyệt chứng từ ${t.code}?` : confirm === 'submit' ? 'Gửi chứng từ đi duyệt?' : `Huỷ chứng từ ${t.code}?`}
        message={
          confirm === 'approve'
            ? `Hệ thống sẽ áp dụng "${t.typeLabel}" cho ${t.items.length} tài sản (cập nhật trạng thái, khoa, người giữ, hạn kiểm định… và ghi dòng thời gian). Không thể hoàn tác trực tiếp.`
            : confirm === 'submit'
              ? 'Người có quyền duyệt sẽ nhận được thông báo.'
              : 'Chứng từ bị huỷ sẽ không còn hiệu lực; tài sản được giải phóng để lập chứng từ khác.'
        }
        confirmText={confirm === 'approve' ? 'Duyệt' : confirm === 'submit' ? 'Gửi duyệt' : 'Huỷ chứng từ'}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        onClose={() => setConfirm(null)}
      />
      <Dialog
        open={reject}
        onClose={() => setReject(false)}
        title="Từ chối chứng từ"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setReject(false)}>
              Đóng
            </Button>
            <Button variant="danger" disabled={!why.trim()} loading={act.isPending} onClick={() => act.mutate('reject')}>
              Từ chối
            </Button>
          </>
        }
      >
        <Textarea rows={3} autoFocus placeholder="Lý do (bắt buộc) — người lập sẽ nhận được thông báo" value={why} onChange={(e) => setWhy(e.target.value)} />
      </Dialog>
    </div>
  );
}
