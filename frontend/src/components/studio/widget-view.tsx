'use client';

/**
 * Studio — hiển thị một ô widget (KPI / biểu đồ / bảng / văn bản / tích hợp).
 * Dữ liệu lấy qua query engine `/studio/query`, tự tải lại khi React Query
 * bị invalidate bởi kênh realtime (SSE).
 */
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Download,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  dateSequence,
  studioApi,
  type StudioDataSpec,
  type StudioQueryResult,
  type StudioWidget,
} from '@/lib/studio';
import { apiFetch, downloadFile } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber } from '@/lib/utils';
import { Skeleton } from '@/components/ui/card';

/* -------------------------------------------------------------- màu sắc */

const PALETTE = [
  'var(--primary)',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#0ea5e9',
  '#f97316',
  '#14b8a6',
  '#a855f7',
  '#64748b',
];

/* ------------------------------------------------------------- dữ liệu */

/** queryKey thống nhất để realtime invalidate theo prefix 'studio-widget' */
export function widgetQueryKey(spec: StudioDataSpec): (string | number)[] {
  return ['studio-widget', JSON.stringify(spec)];
}

export function useWidgetData(spec?: StudioDataSpec, enabled = true) {
  const queryKey: (string | number)[] = ['studio-widget', spec ? JSON.stringify(spec) : '-'];
  return useQuery({
    queryKey,
    queryFn: () => studioApi.run(spec as StudioDataSpec),
    enabled: enabled && !!spec?.source,
    staleTime: 20_000,
    retry: 1,
  });
}

interface ChartRow { name: string;[key: string]: string | number }

/** Chuẩn hoá rows engine → dữ liệu recharts (điền ngày trống khi fillGaps) */
export function toChartData(result: StudioQueryResult, spec: StudioDataSpec, widget: StudioWidget): ChartRow[] {
  const metrics = result.columns.filter((c) => c.role === 'metric');
  let rows = result.rows.map((r) => {
    const out: ChartRow = { name: String(r.d0 ?? r.d1 ?? '—') };
    metrics.forEach((m) => { out[m.key] = Number(r[m.key] ?? 0); });
    return out;
  });
  const dim = spec.dimensions?.[0];
  if (widget.options?.fillGaps && dim?.bucket === 'day' && spec.dateRange && rows.length) {
    const seq = dateSequence(spec.dateRange.preset ?? 'custom', spec.dateRange.from, spec.dateRange.to);
    if (seq.length) {
      rows = seq.map((day) => {
        const hit = result.rows.find((r) => String(r.d0) === day);
        const out: ChartRow = { name: day.slice(5) };
        metrics.forEach((m) => { out[m.key] = hit ? Number(hit[m.key] ?? 0) : 0; });
        return out;
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ KPI */

const KPI_TONES: Record<string, string> = {
  default: 'text-[var(--foreground)]',
  primary: 'text-blue-600',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-rose-600',
  muted: 'text-zinc-500',
};

function KpiView({ widget }: { widget: StudioWidget }) {
  const { data, isLoading, error, dataUpdatedAt } = useWidgetData(widget.dataSpec);
  if (isLoading) return <Skeleton className="h-full min-h-24" />;
  const tone = String(widget.options?.tone ?? 'default');
  const value = data?.rows?.[0]?.m0;
  const fmt = String(widget.options?.format ?? 'number');
  const rendered = error
    ? '—'
    : fmt === 'money'
      ? `${formatNumber(value)} đ`
      : formatNumber(value);
  return (
    <div className="flex h-full flex-col justify-center gap-1">
      <div className="truncate text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {widget.title}
      </div>
      <div className={`text-3xl font-semibold tabular-nums ${KPI_TONES[tone] ?? KPI_TONES.default}`}>
        {rendered}
      </div>
      <div className="truncate text-xs text-[var(--muted-foreground)]">
        {String(widget.options?.hint ?? data?.columns.find((c) => c.key === 'm0')?.label ?? '')}
      </div>
      <div className="text-[10px] text-[var(--muted-foreground)] opacity-70">
        {dataUpdatedAt ? `Cập nhật ${formatDateTime(new Date(dataUpdatedAt).toISOString()).slice(9)}` : ''}
      </div>
      {error ? <div className="text-[11px] text-rose-600 line-clamp-2">{(error as Error).message}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Charts */

function ChartView({ widget }: { widget: StudioWidget }) {
  const { data, isLoading, error } = useWidgetData(widget.dataSpec);
  const chartData = useMemo(
    () => (data && widget.dataSpec ? toChartData(data, widget.dataSpec, widget) : []),
    [data, widget],
  );
  if (isLoading) return <Skeleton className="h-full min-h-40" />;
  if (error) return <WidgetError error={error as Error} />;
  if (!data || !widget.dataSpec) return null;
  const metrics = data.columns.filter((c) => c.role === 'metric');
  if (!chartData.length) return <EmptyChart />;
  const axisX = { fontSize: 11, stroke: 'var(--muted-foreground)' } as const;
  const showLegend = metrics.length > 1;

  if (widget.type === 'pie' || widget.type === 'donut') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="m0"
            nameKey="name"
            innerRadius={widget.type === 'donut' ? '55%' : 0}
            outerRadius="88%"
            paddingAngle={1.5}
            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            fontSize={10}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === 'barh') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={axisX} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ ...axisX, width: 100 }}
            tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
          />
          <Tooltip />
          {metrics.map((m, i) => (
            <Bar key={m.key} dataKey={m.key} name={m.label} fill={PALETTE[i % PALETTE.length]} radius={[0, 6, 6, 0]} maxBarSize={18} />
          ))}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="name" tick={axisX} />
          <YAxis tick={axisX} allowDecimals={false} />
          <Tooltip />
          {metrics.map((m, i) => (
            <Bar key={m.key} dataKey={m.key} name={m.label} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 0, 0]} maxBarSize={34} />
          ))}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const ChartComp = widget.type === 'area' ? AreaChart : LineChart;
  const SeriesComp = widget.type === 'area' ? Area : Line;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ChartComp data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={axisX} />
        <YAxis tick={axisX} allowDecimals={false} />
        <Tooltip />
        {metrics.map((m, i) => (
          <SeriesComp
            key={m.key}
            type="monotone"
            dataKey={m.key}
            name={m.label}
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={2}
            fill={widget.type === 'area' ? PALETTE[i % PALETTE.length] : 'none'}
            fillOpacity={widget.type === 'area' ? 0.18 : 0}
            dot={false}
          />
        ))}
        {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </ChartComp>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
      Chưa có dữ liệu trong phạm vi/kỳ đã chọn
    </div>
  );
}

function WidgetError({ error }: { error: Error }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
      <AlertTriangle className="size-5 text-amber-500" />
      <div className="text-xs text-[var(--muted-foreground)]">{error.message}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- Table */

function TableView({ widget }: { widget: StudioWidget }) {
  const { data, isLoading, error } = useWidgetData(widget.dataSpec);
  if (isLoading) return <Skeleton className="h-full min-h-40" />;
  if (error) return <WidgetError error={error as Error} />;
  if (!data) return null;
  const dim = data.columns.filter((c) => c.role === 'dimension');
  const metrics = data.columns.filter((c) => c.role === 'metric');
  return (
    <div className="flex h-full flex-col">
      {data.meta.truncated ? (
        <div className="mb-1 text-right text-[10px] text-amber-600">
          Dữ liệu bị cắt bớt (tối đa {data.rows.length} dòng)
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--card)]">
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              {[...dim, ...metrics].map((c) => (
                <th key={c.key} className={`px-2 py-1.5 ${c.role === 'metric' ? 'text-right' : ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={dim.length + metrics.length} className="px-2 py-8 text-center text-xs text-[var(--muted-foreground)]">
                  Không có dữ liệu
                </td>
              </tr>
            ) : (
              data.rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-[var(--accent)]">
                  {dim.map((c) => (
                    <td key={c.key} className="px-2 py-1.5">
                      {c.type === 'date' || c.type === 'datetime' ? formatDate(String(row[c.key] ?? '')) : String(row[c.key] ?? '—')}
                    </td>
                  ))}
                  {metrics.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">{formatNumber(row[c.key])}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Text */

function TextView({ widget }: { widget: StudioWidget }) {
  return (
    <div className="prose-sm h-full overflow-auto whitespace-pre-wrap text-sm leading-relaxed">
      {String(widget.options?.text ?? '') || (
        <span className="text-[var(--muted-foreground)]">Nhấn ⚙ để nhập nội dung…</span>
      )}
    </div>
  );
}

/* --------------------------------------------------------- Builtin: jobs */

function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () =>
      apiFetch<{
        jobs: { id: number; name: string; cron: string; active: boolean; lastStatus: string | null; lastRunAt: string | null }[];
        recentAudit: { id: number; fullName: string; username: string; description: string; module: string; entity: string | null; createdAt: string }[];
      }>('/dashboard/summary?days=14'),
    staleTime: 30_000,
  });
}

function BuiltinJobs() {
  const { data, isLoading } = useDashboardSummary();
  if (isLoading || !data) return <Skeleton className="h-full min-h-32" />;
  if (!data.jobs.length) return <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">Chưa cấu hình tác vụ</div>;
  return (
    <div className="h-full divide-y overflow-auto">
      {data.jobs.map((job) => (
        <div key={job.id} className="flex items-center justify-between gap-2 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-sm">{job.name}</div>
            <div className="font-mono text-[10px] text-[var(--muted-foreground)]">{job.cron}</div>
          </div>
          <div className="shrink-0 text-right">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                !job.active
                  ? 'bg-zinc-100 text-zinc-500'
                  : job.lastStatus === 'SUCCESS'
                    ? 'bg-emerald-50 text-emerald-700'
                    : job.lastStatus === 'FAILED'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-amber-50 text-amber-700'
              }`}
            >
              {!job.active ? 'Tắt' : job.lastStatus === 'SUCCESS' ? 'Thành công' : job.lastStatus === 'FAILED' ? 'Lỗi' : 'Chờ chạy'}
            </span>
            <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
              {job.lastRunAt ? formatDateTime(job.lastRunAt) : 'chưa chạy'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BuiltinAudit() {
  const { data, isLoading } = useDashboardSummary();
  if (isLoading || !data) return <Skeleton className="h-full min-h-32" />;
  if (!data.recentAudit.length) return <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">Chưa có hoạt động</div>;
  return (
    <div className="h-full divide-y overflow-auto">
      {data.recentAudit.map((log) => (
        <div key={log.id} className="flex items-start gap-2 py-1.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <span className="font-medium">{log.fullName || log.username}</span>{' '}
              <span className="text-[var(--muted-foreground)]">{log.description}</span>
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)]">
              {log.module} · {log.entity || '—'} · {formatDate(log.createdAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BuiltinNotifications() {
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{ items: { id: number; title: string; body: string; level: string; link: string | null; readAt: string | null; createdAt: string }[] }>(
        '/notifications?limit=8',
      ),
  });
  if (isLoading || !data) return <Skeleton className="h-full min-h-32" />;
  if (!data.items.length) return <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">Không có thông báo</div>;
  return (
    <div className="h-full divide-y overflow-auto">
      {data.items.map((n) => (
        <div key={n.id} className="py-1.5">
          <div className={`text-sm ${n.readAt ? '' : 'font-medium'}`}>{n.title}</div>
          <div className="line-clamp-2 text-xs text-[var(--muted-foreground)]">{n.body}</div>
          <div className="text-[10px] text-[var(--muted-foreground)]">{formatDateTime(n.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- exporter */

function ExportButton({ widget, className = '' }: { widget: StudioWidget; className?: string }) {
  if (!widget.dataSpec?.source) return null;
  return (
    <button
      type="button"
      title="Xuất bảng dữ liệu ra Excel"
      className={`rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] ${className}`}
      onClick={async (e) => {
        e.stopPropagation();
        await downloadFile(
          '/studio/query/export',
          `${widget.title || 'bao-cao'}.xlsx`,
          { method: 'POST', body: JSON.stringify({ ...widget.dataSpec, title: widget.title }) },
        );
      }}
    >
      <Download className="size-3.5" />
    </button>
  );
}

/* --------------------------------------------------------------- compose */

/** Chiều cao theo nấc S/M/L (px) */
export const WIDGET_HEIGHTS: Record<StudioWidget['h'], number> = { S: 132, M: 300, L: 420 };

export function WidgetBody({ widget }: { widget: StudioWidget }) {
  if (widget.type === 'text') return <TextView widget={widget} />;
  if (widget.type === 'builtin') {
    if (widget.builtin === 'jobs') return <BuiltinJobs />;
    if (widget.builtin === 'audit') return <BuiltinAudit />;
    if (widget.builtin === 'notifications') return <BuiltinNotifications />;
    return <EmptyChart />;
  }
  if (widget.type === 'kpi') return <KpiView widget={widget} />;
  if (widget.type === 'table') return <TableView widget={widget} />;
  return <ChartView widget={widget} />;
}

/** Hiển thị widget hoàn chỉnh gồm thanh tiêu đề (dùng trong chế độ xem) */
export function WidgetCard({ widget, height }: { widget: StudioWidget; height: number }) {
  const showHeader = widget.type !== 'kpi' && widget.type !== 'text';
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--card)] shadow-sm"
      style={{ height }}
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="min-w-0 truncate text-sm font-semibold">{widget.title || '—'}</div>
          {widget.type === 'table' || widget.dataSpec ? <ExportButton widget={widget} /> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 p-3">
        <WidgetBody widget={widget} />
      </div>
      {widget.type === 'kpi' ? (
        <div className="absolute right-0 top-0 hidden" />
      ) : null}
    </div>
  );
}
