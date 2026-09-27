'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, ClipboardList, EyeOff, FileSpreadsheet, FileText, LockOpen, Pencil, Play, Printer, RotateCcw, ScanLine, Send, Trash2, Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AssetSubnav, Pill } from '@/components/assets/asset-ui';
import { InventoryFormDialog } from '@/components/assets/inventory-form';
import { InventoryResults } from '@/components/assets/inventory-results';
import { InventoryScanPane } from '@/components/assets/inventory-scan';
import { PageHeader } from '@/components/shared/page-header';
import { ConfirmDialog, DiffDiffDialog, FinishDialog, ResolveDialog } from '@/components/assets/inventory-actions';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { apiFetch, downloadFile, openFileUrl } from '@/lib/api';
import { money } from '@/lib/assets';
import { INVENTORY_STATUS, type InventoryRow } from '@/lib/inventory';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

export interface InventoryDetail extends InventoryRow {
  members: { id: number; fullName: string; username: string }[];
  byDepartment: { departmentId: number | null; departmentName: string | null; expected: number; checked: number; found: number; missing: number; misplaced: number; extra: number; cost: number }[];
  scanners: { userId: number; userName: string; n: number; last: string }[];
  recent: { id: number; code: string; outcome: string; userName: string; scannedAt: string; method: string; assetName: string | null; assetId: number | null }[];
}

const OUTCOME_META: Record<string, { label: string; color: string }> = {
  FOUND: { label: 'Tìm thấy', color: '#16a34a' },
  DUPLICATE: { label: 'Quét lặp', color: '#64748b' },
  EXTRA: { label: 'Ngoài phạm vi', color: '#9333ea' },
  UNKNOWN: { label: 'Chưa có hồ sơ', color: '#be185d' },
  INVALID: { label: 'Mã lỗi', color: '#64748b' },
};

export default function InventoryDetailPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<'results' | 'scan'>('results');
  const [fmtEdit, setFmtEdit] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [conclusion, setConclusion] = useState<string>('');

  const detail = useQuery({
    queryKey: ['asset-inventory', id],
    queryFn: () => apiFetch<InventoryDetail>(`/asset-inventories/${id}`),
    refetchInterval: 15_000,
  });
  const d = detail.data;
  const s = d?.stats;

  const act = useMutation({
    mutationFn: async ({ action, body }: { action: string; body?: unknown }) =>
      apiFetch(`/asset-inventories/${id}/${action}`, { method: 'POST', body: body as Record<string, unknown> }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['asset-inventory', id] });
      void qc.invalidateQueries({ queryKey: ['asset-inventories'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = async () => {
    await apiFetch(`/asset-inventories/${id}`, { method: 'DELETE' });
    toast.success('Đã xoá đợt kiểm kê nháp');
    router.push('/tai-san/kiem-ke');
  };

  const st = d ? (INVENTORY_STATUS[d.status] ?? INVENTORY_STATUS.NHAP) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <Link href="/tai-san/kiem-ke" className="inline-flex items-center gap-1">
            <ArrowLeft className="size-3.5" /> Kiểm kê tài sản
          </Link>
        }
        title={d ? `${d.code} — ${d.name}` : 'Đợt kiểm kê'}
        description={d?.scopeText}
      />
      <AssetSubnav />

      {detail.isLoading || !d ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {/* Dải thông tin + hành động */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <Pill color={st!.color}>{st!.label}</Pill>
                {d.blind && (
                  <Pill color="#9333ea">
                    <EyeOff className="size-3" /> Kiểm kê mù
                  </Pill>
                )}
                {d.snapshotAt && <span className="text-xs text-[var(--muted-foreground)]">Chốt sổ: {formatDateTime(d.snapshotAt)}</span>}
                {d.decisionNo && <span className="text-xs">QĐ: {d.decisionNo}</span>}
                {d.approvedByName && <span className="text-xs text-green-700 dark:text-green-400">Duyệt: {d.approvedByName}{d.completedAt ? ` · ${formatDateTime(d.completedAt)}` : ''}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.can.edit && (
                  <Button variant="outline" size="sm" onClick={() => setFmtEdit(true)}>
                    <Pencil className="size-3.5" /> Sửa
                  </Button>
                )}
                {d.can.start && (
                  <Button size="sm" className="bg-teal-600 hover:bg-teal-700" disabled={act.isPending} onClick={() => act.mutate({ action: 'start' })}>
                    <Play className="size-3.5" /> Bắt đầu (chốt sổ sách)
                  </Button>
                )}
                {d.can.scan && (
                  <Button size="sm" variant={tab === 'scan' ? 'default' : 'outline'} onClick={() => setTab('scan')}>
                    <ScanLine className="size-3.5" /> Quét mã
                  </Button>
                )}
                {d.can.finish && (
                  <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-400" onClick={() => { setConclusion(d.conclusion ?? ''); setShowFinish(true); }}>
                    <Send className="size-3.5" /> Khoá số liệu & trình duyệt
                  </Button>
                )}
                {d.can.reopen && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setConfirm({ title: 'Mở lại kiểm kê', message: 'Các dòng “Thiếu” được đánh dấu tự động sẽ quay về trạng thái chưa kiểm. Dòng đã quét/xử lý không đổi.', action: () => act.mutateAsync({ action: 'reopen' }).then(() => undefined) })}
                  >
                    <LockOpen className="size-3.5" /> Mở lại
                  </Button>
                )}
                {d.can.resolve && s && (s.THIEU + s.THUA + s.KHONG_RO + s.SAI_VI_TRI + s.SAI_TINH_TRANG) > 0 && (
                  <Button size="sm" variant="outline" className="border-purple-400 text-purple-700 hover:bg-purple-50 dark:text-purple-300" onClick={() => setShowResolve(true)}>
                    <ClipboardList className="size-3.5" /> Xử lý chênh lệch {s.unresolved > 0 && <span className="rounded-full bg-purple-600 px-1.5 text-[10px] font-bold text-white">{s.unresolved}</span>}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void openFileUrl(`/asset-inventories/${id}/print`)}>
                  <Printer className="size-3.5" /> In biên bản
                </Button>
                <Button variant="outline" size="sm" onClick={() => void downloadFile(`/asset-inventories/${id}/export`, `kiem-ke-${d.code}.xlsx`)}>
                  <FileSpreadsheet className="size-3.5" /> Excel
                </Button>
                {d.can.cancel && (
                  <Button
                    variant="ghost" size="sm" className="text-[var(--muted-foreground)]"
                    onClick={() => setConfirm({ title: `Huỷ đợt kiểm kê ${d.code}`, message: 'Dữ liệu quét vẫn lưu để tra cứu nhưng đợt kiểm kê không hợp lệ nữa.', action: () => act.mutateAsync({ action: 'cancel' }).then(() => undefined) })}
                  >
                    <RotateCcw className="size-3.5" /> Huỷ đợt
                  </Button>
                )}
                {d.can.remove && (
                  <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setConfirm({ title: `Xoá đợt kiểm kê ${d.code}`, message: 'Đợt kiểm kê nháp và toàn bộ dữ liệu sẽ bị xoá vĩnh viễn.', action: remove })}>
                    <Trash2 className="size-3.5" /> Xoá
                  </Button>
                )}
                {d.can.complete && (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={act.isPending} onClick={() => setConfirm({ title: `Duyệt kết quả kiểm kê ${d.code}`, message: `Hoàn tất đợt kiểm kê: ghi ngày kiểm kê vào ${s?.found ?? 0} tài sản có mặt, cập nhật tình trạng thực tế vào hồ sơ và ghi nhật ký. Các chứng từ xử lý chênh lệch vẫn duyệt riêng.`, action: () => act.mutateAsync({ action: 'complete', body: { updateCondition: true } }).then(() => undefined) })}>
                    <CheckCircle2 className="size-3.5" /> Duyệt kết quả
                  </Button>
                )}
              </div>
            </div>

            {/* Thẻ số liệu */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Theo sổ sách', value: s!.expected, sub: s!.expectedCost ? `${money(s!.expectedCost)} đ` : '', color: '#334155' },
                { label: 'Đã kiểm', value: `${s!.checked}/${s!.expected}`, sub: s!.expected ? `${Math.round((s!.checked / Math.max(1, s!.expected)) * 100)}%` : '', color: '#2563eb' },
                { label: 'Khớp', value: s!.KHOP, color: '#16a34a' },
                { label: 'Sai vị trí', value: s!.SAI_VI_TRI + s!.SAI_TINH_TRANG, sub: s!.SAI_TINH_TRANG ? `${s!.SAI_VI_TRI} vị trí · ${s!.SAI_TINH_TRANG} tình trạng` : undefined, color: '#d97706' },
                { label: 'Thiếu', value: s!.THIEU, sub: s!.THIEU ? `${money(s!.missingValue)} đ còn lại` : undefined, color: '#dc2626' },
                { label: 'Thừa / chưa hồ sơ', value: s!.THUA + s!.KHONG_RO, sub: `${s!.THUA} thừa · ${s!.KHONG_RO} chưa hồ sơ`, color: '#9333ea' },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border p-2.5" style={{ backgroundColor: `${k.color}08` }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: k.color }}>{k.label}</div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: k.color }}>{k.value}</div>
                  {k.sub ? <div className="truncate text-[10px] text-[var(--muted-foreground)]">{k.sub}</div> : null}
                </div>
              ))}
            </div>
            {d.conclusion && (
              <div className="mt-3 rounded-lg bg-[var(--muted)]/50 p-3 text-sm">
                <span className="font-semibold">Kết luận hội đồng: </span>{d.conclusion}
              </div>
            )}
          </Card>

          {/* Tiến độ theo khoa + ngườ quét */}
          {d.can.seeExpected && d.byDepartment.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
              <Card className="overflow-hidden">
                <div className="border-b px-4 py-2.5 text-sm font-semibold">Tiến độ theo khoa/phòng</div>
                <div className="thin-scroll overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                        <th className="px-4 py-2 font-medium">Khoa/phòng</th>
                        {['Theo sổ', 'Đã kiểm', 'Có', 'Thiếu', 'Sai vị trí', 'Thừa'].map((h) => (
                          <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>
                        ))}
                        <th className="w-40 px-4 py-2 font-medium">Tiến độ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byDepartment.map((r, i) => {
                        const p = r.expected ? Math.round((r.checked / r.expected) * 100) : 100;
                        return (
                          <tr key={i} className="border-b last:border-0 hover:bg-[var(--muted)]/40">
                            <td className="px-4 py-2 font-medium">{r.departmentName ?? 'Kho / chưa cấp phát'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.expected}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.checked}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-400">{r.found}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-red-600">{r.missing || ''}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-600">{r.misplaced || ''}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-purple-600">{r.extra || ''}</td>
                            <td className="px-4 py-2">
                              <div className="h-1.5 rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-teal-600" style={{ width: `${p}%` }} /></div>
                              <div className="mt-0.5 text-right text-[10px] text-[var(--muted-foreground)]">{p}%</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-teal-600" /> Ngườ tham gia</div>
                <div className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between text-xs text-[var(--muted-foreground)]"><span>Ngườ lập</span><span className="font-medium text-[var(--foreground)]">{d.createdByName}</span></div>
                  {d.members.length > 0 && (
                    <div className="text-xs text-[var(--muted-foreground)]">
                      Phân công: <span className="text-[var(--foreground)]">{d.members.map((m) => m.fullName).join(', ')}</span>
                    </div>
                  )}
                  {d.scanners.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      {d.scanners.map((sc) => (
                        <div key={sc.userId} className="flex items-center justify-between py-0.5 text-xs">
                          <span>{sc.userName}</span>
                          <span className="tabular-nums text-[var(--muted-foreground)]">{sc.n} lượt · {formatDateTime(sc.last)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {d.recent.length > 0 && (
                  <div className="mt-3 border-t pt-2">
                    <div className="text-xs font-semibold text-[var(--muted-foreground)]">Lượt quét gần nhất</div>
                    <div className="thin-scroll mt-1 max-h-48 space-y-1 overflow-y-auto">
                      {d.recent.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs">
                          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: OUTCOME_META[r.outcome]?.color ?? '#64748b' }} />
                          <span className="truncate font-mono">{r.code}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-[var(--muted-foreground)]">{formatDateTime(r.scannedAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Hai thẻ: kết quả chi tiết / quét */}
          <div className="flex gap-1 border-b">
            {(['results', 'scan'] as const).map((t) => {
              const lbl = t === 'results' ? 'Kết quả chi tiết' : 'Quét mã';
              if (t === 'scan' && !d.can.scan && tab !== 'scan') return null;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn('border-b-2 px-4 py-2 text-sm font-medium transition-colors', tab === t ? 'border-teal-600 text-teal-700 dark:text-teal-400' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}
                >
                  {t === 'scan' ? (
                    <span className="inline-flex items-center gap-1.5"><ScanLine className="size-4" />{lbl}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5"><FileText className="size-4" />{lbl}</span>
                  )}
                </button>
              );
            })}
          </div>
          {tab === 'results' ? <InventoryResults id={id} detail={d} /> : <InventoryScanPane id={id} detail={d} />}
        </>
      )}

      <InventoryFormDialog open={fmtEdit} editing={d ?? null} onClose={() => setFmtEdit(false)} onSaved={() => { setFmtEdit(false); void qc.invalidateQueries({ queryKey: ['asset-inventory', id] }); }} />
      <FinishDialog open={showFinish} onClose={() => setShowFinish(false)} onSubmit={(c) => act.mutateAsync({ action: 'finish', body: { conclusion: c } }).then(() => setShowFinish(false))} pending={act.isPending} conclusion={conclusion} setConclusion={setConclusion} detail={d} />
      {d && <ResolveDialog open={showResolve} onClose={() => setShowResolve(false)} inventoryId={id} detail={d} />}
      <ConfirmDialog {...(confirm ?? { title: '', message: '', action: async () => undefined })} open={!!confirm} onClose={() => setConfirm(null)} pending={act.isPending} />

    </div>
  );
}
