'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpDown, BookOpen, Building2, CalendarClock, ClipboardList, FileSpreadsheet, Hourglass, LineChart, Printer, RefreshCw, Trash2, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AssetSubnav, Kpi, Pill } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { apiFetch, downloadFile, openFileUrl } from '@/lib/api';
import { ASSET_STATUS, GROUP_COLORS, money, moneyShort, treeLabel, useAssetCatalog, useAssetOptions } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  BookOpen, ArrowUpDown, Building2, Wrench, CalendarClock, Hourglass, Trash2, ClipboardList, LineChart,
};

export interface ReportColumn {
  key: string; title: string; type?: 'text' | 'money' | 'int' | 'date' | 'pct' | 'status'; width?: number;
}
export interface ReportRow {
  _kind?: 'group' | 'subtotal' | 'total';
  _link?: string;
  _overdue?: boolean;
  [key: string]: unknown;
}
export interface ReportParam {
  key: string; label: string; type: 'date' | 'select' | 'number' | 'department' | 'category' | 'status' | 'group';
  default?: unknown; options?: { value: string; label: string }[];
}
export interface ReportDef {
  key: string; title: string; description: string; icon: string; color: string; params: ReportParam[];
}
export interface ReportResult {
  key: string; title: string; subtitle: string; params: Record<string, unknown>;
  columns: ReportColumn[]; rows: ReportRow[];
  summary: { label: string; value: number; type?: string; color?: string }[];
  chart?: { type: 'bar' | 'pie'; label: string; data: { name: string; value: number; value2?: number }[]; valueLabel?: string; value2Label?: string };
}

const display = (c: ReportColumn, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'money': return money(v);
    case 'int': return Number(v).toLocaleString('vi-VN');
    case 'pct': return `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
    case 'date': return formatDate(String(v));
    case 'status': return ASSET_STATUS[String(v)]?.label ?? String(v);
    default: return String(v);
  }
};

function ReportShell() {
  const can = useAuth((s) => s.can);
  const router = useRouter();
  const sp = useSearchParams();
  const key = sp.get('k') ?? '';
  const options = useAssetOptions();
  const cats = useAssetCatalog('categories', true);
  const meta = useQuery({
    queryKey: ['asset-report-catalog'],
    queryFn: () => apiFetch<ReportDef[]>('/asset-reports'),
    staleTime: 600_000,
  });
  const defs = meta.data ?? [];
  const def = defs.find((d) => d.key === key);

  /* Thông số: khởi tạo mặc định từ server, thay đổi → cache param riêng mỗi báo cáo */
  const [params, setParams] = useState<Record<string, string>>({});
  const resolved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of def?.params ?? []) out[p.key] = params[p.key] ?? String(p.default ?? '');
    return out;
  }, [def, params]);

  const qs = useMemo(
    () => new URLSearchParams(Object.fromEntries(Object.entries(resolved).filter(([, v]) => v !== ''))).toString(),
    [resolved],
  );
  const report = useQuery({
    queryKey: ['asset-report', key, qs],
    queryFn: () => apiFetch<ReportResult>(`/asset-reports/${key}?${qs}`),
    enabled: !!def,
    retry: false,
  });

  if (!can('asset.report.view') && can('asset.view')) {
    return (
      <Card className="p-8 text-center text-sm text-[var(--muted-foreground)]">
        Bạn cần quyền “Xem báo cáo tài sản” để dùng trang này.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>} title="Báo cáo tài sản sẵn có" description="Các báo cáo chuẩn: sổ TSCĐ, tăng giảm, theo khoa, chi phí, đến hạn, thanh lý, kiểm kê — xuất Excel, in PDF." />
      <AssetSubnav />

      {/* Chọn báo cáo */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {defs.map((r) => {
          const Icon = ICONS[r.icon] ?? BookOpen;
          const active = key === r.key;
          return (
            <button
              key={r.key}
              onClick={() => (router.push(`/tai-san/bao-cao?k=${r.key}`), setParams({}))}
              className={cn('group rounded-[var(--radius-card)] border bg-[var(--card)] p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md', active && 'ring-2 ring-teal-600/70')}
            >
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-lg text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${r.color}, ${r.color}bb)` }}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className={cn('truncate text-sm font-semibold', active && 'text-teal-700 dark:text-teal-400')}>{r.title}</div>
                </div>
              </div>
              <div className="mt-2 line-clamp-2 min-h-[30px] text-xs text-[var(--muted-foreground)]">{r.description}</div>
            </button>
          );
        })}
      </div>

      {/* Thông số + hành động */}
      {def && (
        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-2">
            {def.params.map((p) => (
              <div key={p.key} className="min-w-[150px]">
                <div className="mb-1 text-[11px] font-medium text-[var(--muted-foreground)]">{p.label}</div>
                {p.type === 'date' ? (
                  <input type="date" className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm" value={resolved[p.key]} onChange={(e) => setParams((x) => ({ ...x, [p.key]: e.target.value }))} />
                ) : p.type === 'number' ? (
                  <input type="number" className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm" value={resolved[p.key]} onChange={(e) => setParams((x) => ({ ...x, [p.key]: e.target.value }))} />
                ) : (
                  <select className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm" value={resolved[p.key]} onChange={(e) => setParams((x) => ({ ...x, [p.key]: e.target.value }))}>
                    {p.type !== 'select' && <option value="">Tất cả</option>}
                    {p.type === 'department' && (options.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    {p.type === 'department' && <option value="-1">Kho / chưa cấp phát</option>}
                    {p.type === 'category' && (cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{treeLabel(c as never)}</option>)}
                    {p.type === 'group' && Object.entries({ THIET_BI_Y_TE: 'Thiết bị y tế', CNTT: 'CNTT', MAY_MOC: 'Máy móc, thiết bị', NOI_THAT: 'Nội thất', PHUONG_TIEN: 'Phương tiện', NHA_CUA: 'Nhà cửa', CCDC: 'CCDC', KHAC: 'Khác' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    {p.type === 'status' && <><option value="ACTIVE">Đang theo dõi</option>{Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="">Tất cả (kể cả đã giảm)</option></>}
                    {p.type === 'select' && (p.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
            ))}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void report.refetch()}>
                <RefreshCw className={cn('size-3.5', report.isFetching && 'animate-spin')} /> Làm mới
              </Button>
              <Button variant="outline" size="sm" onClick={() => void downloadFile(`/asset-reports/${key}/export?${qs}`, `bao-cao-${key}.xlsx`)}>
                <FileSpreadsheet className="size-3.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openFileUrl(`/asset-reports/${key}/print?${qs}`)}>
                <Printer className="size-3.5" /> In PDF
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Kết quả */}
      {def &&
        (report.isLoading ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
            <Skeleton className="h-96" />
          </div>
        ) : report.isError ? (
          <Card className="p-6 text-sm text-red-600">{(report.error as Error).message}</Card>
        ) : report.data ? (
          <ReportView r={report.data} />
        ) : null)}
      
    </div>
  );
}

function ReportView({ r }: { r: ReportResult }) {
  return (
    <div className="space-y-4">
      {/* Thẻ tóm tắt */}
      {r.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {r.summary.map((s) => (
            <Kpi
              key={s.label}
              label={s.label}
              value={s.type === 'money' ? `${money(s.value)} đ` : typeof s.value === 'number' ? s.value.toLocaleString('vi-VN') : String(s.value)}
              color={s.color}
              icon={<span className="text-sm font-bold">{s.type === 'money' ? 'đ' : '#'}</span>}
            />
          ))}
        </div>
      )}

      {/* Biểu đồ */}
      {r.chart && r.chart.data.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">{r.chart.label}</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              {r.chart.type === 'pie' ? (
                <PieChart>
                  <Pie data={r.chart.data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={88} label={({ name, percent }) => `${name} ${(Number(percent) * 100).toFixed(0)}%`} labelLine={false}>
                    {r.chart.data.map((d, i) => (
                      <Cell key={i} fill={GROUP_COLORS[i % GROUP_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: unknown) => [`${money(v)} đ`, 'Giá trị']} />
                  <Legend />
                </PieChart>
              ) : (
                <BarChart data={r.chart.data} margin={{ top: 4, right: 8, bottom: 8, left: 8 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={64} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={moneyShort} />
                  <Tooltip formatter={(v: unknown) => `${money(v)} đ`} labelStyle={{ fontWeight: 700 }} />
                  <Legend />
                  <Bar dataKey="value" name={r.chart.valueLabel ?? 'Giá trị 1'} fill="#0d9488" radius={[4, 4, 0, 0]} />
                  {r.chart.value2Label && <Bar dataKey="value2" name={r.chart.value2Label} fill="#94a3b8" radius={[4, 4, 0, 0]} />}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Bảng */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-2.5">
          <span className="text-sm font-semibold">{r.title}</span>
          <span className="ml-2 text-xs text-[var(--muted-foreground)]">{r.subtitle}</span>
        </div>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[1100px] text-xs">
            <thead>
              <tr className="border-b bg-[var(--muted)]/50 text-left uppercase tracking-wide text-[var(--muted-foreground)]">
                {r.columns.map((c) => (
                  <th key={c.key} className={cn('px-3 py-2 font-medium', ['money', 'int', 'pct'].includes(c.type ?? '') && 'text-right', c.type === 'date' && 'text-center')} style={{ minWidth: c.width ? Math.max(50, c.width * 3.4) : undefined }}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => {
                const Inner = (
                  <>
                    {r.columns.map((c) => {
                      const v = display(c, row[c.key]);
                      const align = ['money', 'int', 'pct'].includes(c.type ?? '') ? 'text-right' : c.type === 'date' ? 'text-center' : '';
                      return (
                        <td key={c.key} className={cn('px-3 py-1.5 tabular-nums', align, row._kind === 'group' && 'font-bold', row._kind === 'subtotal' && 'font-semibold italic', row._kind === 'total' && 'font-bold', (row._overdue as boolean) && c.key === 'daysText' && 'font-bold text-red-600')}>
                          {c.key === 'stt' && row._kind === 'group' ? '' : row._kind === 'group' && c.key !== 'name' && c.key !== 'code' && c.key !== 'label' ? '' : v}
                        </td>
                      );
                    })}
                  </>
                );
                const cls = cn(
                  'border-b last:border-0',
                  row._kind === 'group' && 'bg-slate-100 dark:bg-slate-800/50',
                  row._kind === 'subtotal' && 'bg-slate-50 dark:bg-slate-800/30',
                  row._kind === 'total' && 'sticky bottom-0 bg-slate-100 font-bold shadow-[0_-1px_0_var(--border)] dark:bg-slate-800',
                  !row._kind && 'hover:bg-[var(--muted)]/40',
                );
                return row._link ? (
                  <tr key={i} className={cn(cls, 'cursor-pointer')} onClick={() => window.open(String(row._link), '_blank')}>
                    {Inner}
                  </tr>
                ) : (
                  <tr key={i} className={cls}>{Inner}</tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function AssetReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ReportShell />
    </Suspense>
  );
}
