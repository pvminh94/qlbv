'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, CalendarRange, CheckCircle2, Download, Eye, Lock, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { AssetSubnav, Pill } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch, downloadFile } from '@/lib/api';
import { money, moneyShort } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

interface Suggest { lastYearly: string | null; lastMonthly: string | null; yearlyAssets: number; monthlyAssets: number; suggestedYear: string; suggestedMonth: string }
interface Line { assetId: number; code: string; name: string; method: string; costBasis: number; amount: number; accumulatedBefore: number; accumulatedAfter: number; bookValueAfter: number; departmentName?: string | null; categoryName?: string | null; warning?: string }
interface Preview {
  period: string; periodType: 'YEARLY' | 'MONTHLY'; lines: Line[]; total: number; warnings: string[];
  skipped: { done: number; notStarted: number; fullyDepreciated: number; noStartDate: number };
  byDepartment: { departmentId: number; name: string; count: number; amount: number }[];
  existingRun: { id: number } | null; methodLabels: Record<string, string>;
}
interface Run { id: number; period: string; periodType: string; status: string; assetCount: number; totalAmount: number; note: string; createdByName: string; createdAt: string }
interface RunDetail extends Run { lines: Line[]; byDepartment: Preview['byDepartment'] }

export default function DepreciationPage() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [mode, setMode] = useState<'YEARLY' | 'MONTHLY'>('YEARLY');
  const [period, setPeriod] = useState('');
  const [previewKey, setPreviewKey] = useState('');
  const [note, setNote] = useState('');
  const [confirmRun, setConfirmRun] = useState(false);
  const [cancelRun, setCancelRun] = useState<Run | null>(null);
  const [viewRun, setViewRun] = useState<number | null>(null);
  const [onlyWarn, setOnlyWarn] = useState(false);

  const sug = useQuery({ queryKey: ['depr-suggest'], queryFn: () => apiFetch<Suggest>('/asset-depreciation/suggest') });
  const runs = useQuery({ queryKey: ['depr-runs'], queryFn: () => apiFetch<Run[]>('/asset-depreciation/runs') });
  useEffect(() => {
    if (sug.data && !period) setPeriod(mode === 'YEARLY' ? sug.data.suggestedYear : sug.data.suggestedMonth);
  }, [sug.data, mode, period]);

  const preview = useQuery({
    queryKey: ['depr-preview', previewKey],
    queryFn: () => apiFetch<Preview>(`/asset-depreciation/preview?period=${previewKey}`),
    enabled: Boolean(previewKey),
    retry: false,
  });
  const detail = useQuery({ queryKey: ['depr-run', viewRun], queryFn: () => apiFetch<RunDetail>(`/asset-depreciation/runs/${viewRun}`), enabled: viewRun !== null });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['depr-suggest'] });
    qc.invalidateQueries({ queryKey: ['depr-runs'] });
    qc.invalidateQueries({ queryKey: ['depr-preview'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['asset-dashboard'] });
  };
  const run = useMutation({
    mutationFn: () => apiFetch<Run>('/asset-depreciation/runs', { method: 'POST', body: { period: previewKey, note } }),
    onSuccess: (r) => {
      toast.success(`Đã chốt kỳ ${r.period ?? previewKey}`);
      setConfirmRun(false);
      setNote('');
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => apiFetch(`/asset-depreciation/runs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Đã huỷ kỳ — luỹ kế tài sản được hoàn lại');
      setCancelRun(null);
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const switchMode = (m: 'YEARLY' | 'MONTHLY') => {
    setMode(m);
    setPeriod(m === 'YEARLY' ? (sug.data?.suggestedYear ?? '') : (sug.data?.suggestedMonth ?? ''));
    setPreviewKey('');
  };
  const validPeriod = mode === 'YEARLY' ? /^\d{4}$/.test(period) : /^\d{4}-\d{2}$/.test(period);
  const p = preview.data;
  const lines = (p?.lines ?? []).filter((l) => !onlyWarn || l.warning);
  const activeRuns = (runs.data ?? []).filter((r) => r.status === 'DA_CHOT');
  const latestByType = new Map<string, number>();
  for (const r of activeRuns) if (!latestByType.has(r.periodType)) latestByType.set(r.periodType, r.id);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>}
        title="Khấu hao / hao mòn"
        description="Hao mòn năm theo TT23/2023/TT-BTC (đơn vị HCSN) hoặc khấu hao tháng (đường thẳng, số dư giảm dần). Xem trước → chốt kỳ → sổ theo dõi Excel."
      />
      <AssetSubnav />

      <div className="grid gap-3 md:grid-cols-2">
        {([
          { m: 'YEARLY', t: 'Hao mòn năm (TT23)', last: sug.data?.lastYearly, n: sug.data?.yearlyAssets, icon: CalendarRange, hint: 'Tính 1 lần/năm vào 31/12 — mức năm = nguyên giá × tỉ lệ, làm tròn theo quy định' },
          { m: 'MONTHLY', t: 'Khấu hao tháng', last: sug.data?.lastMonthly, n: sug.data?.monthlyAssets, icon: Calculator, hint: 'Đường thẳng theo tháng / số dư giảm dần — cho tài sản dùng vào hoạt động dịch vụ' },
        ] as const).map((x) => (
          <button
            key={x.m}
            type="button"
            onClick={() => switchMode(x.m)}
            className={cn('rounded-2xl border p-4 text-left transition-all', mode === x.m ? 'border-teal-500 bg-gradient-to-br from-teal-50 to-white shadow-md ring-2 ring-teal-500/20' : 'bg-[var(--card)] hover:border-teal-300')}
          >
            <div className="flex items-center gap-2">
              <div className={cn('grid size-9 place-items-center rounded-xl', mode === x.m ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600')}>
                <x.icon className="size-5" />
              </div>
              <div>
                <div className="font-semibold">{x.t}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{x.n ?? 0} tài sản áp dụng · kỳ đã chốt gần nhất: <b>{x.last ?? 'chưa có'}</b></div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">{x.hint}</div>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">{mode === 'YEARLY' ? 'Năm' : 'Tháng'}</span>
            {mode === 'YEARLY' ? (
              <Input className="w-32" type="number" min={2000} max={2100} value={period} onChange={(e) => setPeriod(e.target.value)} />
            ) : (
              <Input className="w-44" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            )}
          </label>
          <Button className="bg-teal-600 hover:bg-teal-700" disabled={!validPeriod} loading={preview.isFetching} onClick={() => (setPreviewKey(period), previewKey === period && preview.refetch())}>
            <Eye className="size-4" /> Xem trước
          </Button>
          {sug.data ? (
            <span className="text-xs text-[var(--muted-foreground)]">
              Gợi ý kỳ cần chốt: <b>{mode === 'YEARLY' ? sug.data.suggestedYear : sug.data.suggestedMonth}</b>
            </span>
          ) : null}
        </div>
        {preview.error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(preview.error as Error).message}</div> : null}
      </Card>

      {p ? (
        <div className="space-y-4">
          {p.existingRun ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <Lock className="size-4" /> Kỳ {p.period} đã được chốt. Muốn tính lại hãy huỷ kỳ trong lịch sử bên dưới (chỉ huỷ được kỳ mới nhất).
            </div>
          ) : null}
          {p.warnings.map((w) => (
            <div key={w} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <AlertTriangle className="size-4 shrink-0" /> {w}
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase text-[var(--muted-foreground)]">Tổng {p.periodType === 'YEARLY' ? 'hao mòn' : 'khấu hao'} kỳ {p.period}</div>
              <div className="text-2xl font-bold tabular-nums text-teal-700">{moneyShort(p.total)}</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">{money(p.total)} đ</div>
            </Card>
            <Card className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase text-[var(--muted-foreground)]">Tài sản được tính</div>
              <div className="text-2xl font-bold tabular-nums">{p.lines.length}</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">{p.lines.filter((l) => l.warning).length} cần lưu ý</div>
            </Card>
            <Card className="col-span-2 px-4 py-3 text-xs">
              <div className="mb-1 text-[11px] font-medium uppercase text-[var(--muted-foreground)]">Bỏ qua</div>
              <div className="grid grid-cols-2 gap-1">
                <span>Đã tính kỳ này: <b>{p.skipped.done}</b></span>
                <span>Chưa đến ngày bắt đầu: <b>{p.skipped.notStarted}</b></span>
                <span>Đã hết giá trị: <b>{p.skipped.fullyDepreciated}</b></span>
                <span className={cn(p.skipped.noStartDate && 'text-red-600')}>Thiếu ngày bắt đầu: <b>{p.skipped.noStartDate}</b></span>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <div className="text-sm font-semibold">Chi tiết từng tài sản</div>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" className="accent-teal-600" checked={onlyWarn} onChange={(e) => setOnlyWarn(e.target.checked)} /> Chỉ tài sản cần lưu ý
                </label>
              </div>
              <div className="thin-scroll max-h-[480px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--muted)] text-left text-xs">
                    <tr>
                      <th className="p-2">Tài sản</th>
                      <th className="p-2">Phương pháp</th>
                      <th className="p-2 text-right">Nguyên giá</th>
                      <th className="p-2 text-right">Luỹ kế trước</th>
                      <th className="p-2 text-right">Kỳ này</th>
                      <th className="p-2 text-right">Còn lại sau</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.assetId} className={cn('border-t', l.warning && 'bg-amber-50/60')}>
                        <td className="p-2">
                          <Link href={`/tai-san/${l.assetId}`} className="font-mono text-xs font-semibold text-teal-700 hover:underline">
                            {l.code}
                          </Link>
                          <div className="text-xs">{l.name}</div>
                          {l.warning ? <div className="text-[11px] text-amber-700">⚠ {l.warning}</div> : null}
                        </td>
                        <td className="p-2 text-[11px]">{p.methodLabels[l.method] ?? l.method}</td>
                        <td className="p-2 text-right tabular-nums">{money(l.costBasis)}</td>
                        <td className="p-2 text-right tabular-nums text-[var(--muted-foreground)]">{money(l.accumulatedBefore)}</td>
                        <td className="p-2 text-right font-semibold tabular-nums text-teal-700">{money(l.amount)}</td>
                        <td className="p-2 text-right tabular-nums">{money(l.bookValueAfter)}</td>
                      </tr>
                    ))}
                    {!lines.length ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-sm text-[var(--muted-foreground)]">
                          Không có tài sản nào cần tính trong kỳ này
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Theo khoa/phòng</div>
              {p.byDepartment.length ? (
                <div style={{ height: Math.max(160, p.byDepartment.length * 30) }}>
                  <ResponsiveContainer>
                    <BarChart data={p.byDepartment} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tickFormatter={(v) => moneyShort(v)} tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => [`${money(v)} đ`, 'Số tiền']} />
                      <Bar dataKey="amount" fill="#0d9488" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-xs text-[var(--muted-foreground)]">—</div>
              )}
              {can('asset.depreciation.run') && !p.existingRun && p.lines.length ? (
                <div className="mt-4 space-y-2 border-t pt-4">
                  <Input placeholder="Ghi chú kỳ (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setConfirmRun(true)}>
                    <CheckCircle2 className="size-4" /> Chốt kỳ {p.period}
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      ) : null}

      {/* Lịch sử */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3 text-sm font-semibold">Lịch sử các kỳ đã chốt</div>
        {runs.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : runs.data?.length ? (
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs">
              <tr>
                <th className="p-2">Kỳ</th>
                <th className="p-2">Loại</th>
                <th className="p-2 text-right">Số tài sản</th>
                <th className="p-2 text-right">Tổng tiền</th>
                <th className="p-2">Người chốt</th>
                <th className="p-2">Ghi chú</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id} className={cn('border-t', r.status === 'DA_HUY' && 'opacity-50')}>
                  <td className="p-2 font-mono font-semibold">{r.period}</td>
                  <td className="p-2 text-xs">{r.periodType === 'YEARLY' ? 'Hao mòn năm' : 'Khấu hao tháng'}</td>
                  <td className="p-2 text-right tabular-nums">{r.assetCount}</td>
                  <td className="p-2 text-right tabular-nums">{money(r.totalAmount)}</td>
                  <td className="p-2 text-xs">
                    {r.createdByName}
                    <div className="text-[var(--muted-foreground)]">{formatDateTime(r.createdAt)}</div>
                  </td>
                  <td className="p-2 text-xs">{r.note}</td>
                  <td className="p-2">{r.status === 'DA_CHOT' ? <Pill color="#16a34a">Đã chốt</Pill> : <Pill color="#64748b">Đã huỷ</Pill>}</td>
                  <td className="whitespace-nowrap p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setViewRun(r.id)} title="Xem">
                      <Eye className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadFile(`/asset-depreciation/runs/${r.id}/export`, `so-khau-hao-${r.period}.xlsx`)} title="Xuất sổ Excel">
                      <Download className="size-4" />
                    </Button>
                    {can('asset.depreciation.run') && r.status === 'DA_CHOT' && latestByType.get(r.periodType) === r.id ? (
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelRun(r)} title="Huỷ kỳ">
                        <Undo2 className="size-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Chưa chốt kỳ nào" description="Chọn kỳ, bấm Xem trước rồi Chốt kỳ." />
        )}
      </Card>

      <ConfirmDialog
        open={confirmRun}
        title={`Chốt kỳ ${previewKey}?`}
        message={`Ghi ${p?.lines.length ?? 0} dòng, tổng ${money(p?.total ?? 0)} đ vào luỹ kế của từng tài sản. Có thể huỷ nếu đây là kỳ mới nhất.`}
        confirmText="Chốt kỳ"
        loading={run.isPending}
        onConfirm={() => run.mutate()}
        onClose={() => setConfirmRun(false)}
      />
      <ConfirmDialog
        open={!!cancelRun}
        title={`Huỷ kỳ ${cancelRun?.period}?`}
        message="Luỹ kế hao mòn/khấu hao của các tài sản trong kỳ sẽ được hoàn lại như trước khi chốt."
        confirmText="Huỷ kỳ"
        loading={cancel.isPending}
        onConfirm={() => cancelRun && cancel.mutate(cancelRun.id)}
        onClose={() => setCancelRun(null)}
      />
      <Dialog open={viewRun !== null} onClose={() => setViewRun(null)} size="xl" title={detail.data ? `Kỳ ${detail.data.period} — ${detail.data.assetCount} tài sản · ${money(detail.data.totalAmount)} đ` : 'Đang tải…'}>
        {detail.data ? (
          <div className="thin-scroll max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--muted)] text-left text-xs">
                <tr>
                  <th className="p-2">Tài sản</th>
                  <th className="p-2">Khoa/phòng</th>
                  <th className="p-2 text-right">Nguyên giá</th>
                  <th className="p-2 text-right">Kỳ này</th>
                  <th className="p-2 text-right">Luỹ kế</th>
                  <th className="p-2 text-right">Còn lại</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.lines.map((l) => (
                  <tr key={l.assetId} className="border-t">
                    <td className="p-2">
                      <span className="font-mono text-xs text-teal-700">{l.code}</span> <span className="text-xs">{l.name}</span>
                    </td>
                    <td className="p-2 text-xs">{l.departmentName ?? 'Kho'}</td>
                    <td className="p-2 text-right tabular-nums">{money(l.costBasis)}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{money(l.amount)}</td>
                    <td className="p-2 text-right tabular-nums">{money(l.accumulatedAfter)}</td>
                    <td className="p-2 text-right tabular-nums">{money(l.bookValueAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Skeleton className="h-40" />
        )}
      </Dialog>
    </div>
  );
}
