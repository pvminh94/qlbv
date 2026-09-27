'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Download, Filter, Shield, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AssetSubnav, DueBadge, Pill } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { money, useAssetMeta, useAssetOptions } from '@/lib/assets';
import { cn, formatDate } from '@/lib/utils';

export interface ScheduleEvent {
  date: string; kind: 'calibration' | 'maintenance' | 'warranty'; projected: boolean;
  assetId: number; code: string; name: string; department: string; location: string; status: string; riskClass: string; daysLeft: number;
}
export interface ScheduleData {
  from: string; to: string; today: string;
  events: ScheduleEvent[]; overdue: ScheduleEvent[];
  counts: { calibration: number; maintenance: number; warranty: number; overdue: number; assets: number };
}

const KIND = {
  calibration: { label: 'Kiểm định', color: '#2563eb', icon: Shield },
  maintenance: { label: 'Bảo dưỡng', color: '#d97706', icon: Wrench },
  warranty: { label: 'Hết bảo hành', color: '#64748b', icon: CalendarClock },
};
const DOW = ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'];
const DOW_H = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function MaintenancePage() {
  const options = useAssetOptions();
  const [cursor, setCursor] = useState(() => monthStart(new Date()));
  const [f, setF] = useState({ departmentId: '', kinds: ['calibration', 'maintenance', 'warranty'] as string[], hideProjected: false });
  const from = iso(monthStart(cursor));
  const to = iso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const qs = new URLSearchParams({ from, to, types: f.kinds.join(','), ...(f.departmentId ? { departmentId: f.departmentId } : {}) });
  const q = useQuery({
    queryKey: ['asset-schedule', qs],
    queryFn: () => apiFetch<ScheduleData>(`/asset-reports/schedule?${qs}`),
    refetchInterval: 60_000,
  });
  const d = q.data;

  /* Bản đồ ngày → sự kiện (hiển thị trong tháng) */
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of d?.events ?? []) {
      if (f.hideProjected && e.projected) continue;
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [d?.events, f.hideProjected]);

  /* Tải ICS cho khoảng đang xem */
  const downloadIcs = () => {
    if (!d) return;
    const stamp = (s: string) => s.replaceAll('-', '');
    const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QLBS//Lich bao tri tai san//VI', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Lịch bảo trì / kiểm định tài sản', `X-WR-TIMEZONE:Asia/Ho_Chi_Minh`];
    for (const e of d.events) {
      if (e.projected) continue;
      const end = new Date(Date.parse(e.date) + 86_400_000);
      const endISO = iso(end);
      lines.push(
        'BEGIN:VEVENT',
        `UID:asset-${e.assetId}-${e.kind}-${e.date}@qlbs`,
        `DTSTART;VALUE=DATE:${stamp(e.date)}`,
        `DTEND;VALUE=DATE:${stamp(endISO)}`,
        `SUMMARY:[${KIND[e.kind].label}] ${esc(`${e.code} — ${e.name}`)}`,
        `DESCRIPTION:${esc(`Khoa/phòng: ${e.department}. Mã: ${e.code}`)}`,
        'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:Nhắc ${KIND[e.kind].label} ${esc(e.code)}`, 'END:VALARM',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lich-bao-tri-${from}_${to}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cells = useMemo(() => {
    const first = monthStart(cursor);
    const startDow = first.getDay();
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const prevDays = new Date(cursor.getFullYear(), cursor.getMonth(), 0).getDate();
    const out: { date: Date; iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const off = i - startDow;
      const dt = new Date(cursor.getFullYear(), cursor.getMonth(), off + 1);
      const inMonth = off >= 0 && off < days;
      out.push({ date: dt, iso: iso(dt), inMonth });
    }
    void prevDays;
    return out;
  }, [cursor]);
  const today = d?.today ?? iso(new Date());

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>}
        title="Lịch bảo trì, kiểm định, bảo hành"
        description="Kế hoạch theo tháng, các lần lặp dự kiến theo chu kỳ, thiết bị quá hạn — xuất lịch về Outlook/Google Calendar (ICS)."
        actions={
          <Button variant="outline" onClick={downloadIcs} disabled={!d}>
            <Download className="size-4" /> Tải lịch (.ics)
          </Button>
        }
      />
      <AssetSubnav />

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-[var(--muted-foreground)]" />
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
          <button
            key={k}
            onClick={() => setF((x) => ({ ...x, kinds: x.kinds.includes(k) ? x.kinds.filter((y) => y !== k) : [...x.kinds, k] }))}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-all', f.kinds.includes(k) ? 'text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)]')}
            style={f.kinds.includes(k) ? { backgroundColor: KIND[k].color, boxShadow: `inset 0 0 0 1px ${KIND[k].color}` } : { boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            {KIND[k].label}
          </button>
        ))}
        <select
          className="h-8 rounded-lg border bg-transparent px-2 text-xs"
          value={f.departmentId}
          onChange={(e) => setF((x) => ({ ...x, departmentId: e.target.value }))}
        >
          <option value="">Mọi khoa/phòng</option>
          <option value="-1">Kho</option>
          {(options.data?.departments ?? []).map((dp) => (
            <option key={dp.id} value={dp.id}>{dp.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" className="accent-teal-600" checked={f.hideProjected} onChange={(e) => setF((x) => ({ ...x, hideProjected: e.target.checked }))} />
          Ẩn lần lặp dự kiến
        </label>
      </div>

      {q.isLoading || !d ? (
        <Skeleton className="h-[520px]" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Card className="overflow-hidden">
            {/* Điều hướng tháng */}
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
                  <ChevronLeft className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCursor(monthStart(new Date()))}>Hôm nay</Button>
                <Button variant="ghost" size="sm" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <div className="text-base font-bold capitalize">
                {cursor.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}
              </div>
              <div className="flex gap-2 text-[11px]">
                <span className="rounded bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-950/50">KĐ: {d.counts.calibration}</span>
                <span className="rounded bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950/50">BD: {d.counts.maintenance}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800">BH: {d.counts.warranty}</span>
              </div>
            </div>
            <div className="grid grid-cols-7 border-b text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {DOW.map((x) => (
                <div key={x} className="border-l py-1.5 first:border-0">{x}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((c) => {
                const evs = byDay.get(c.iso) ?? [];
                const isToday = c.iso === today;
                return (
                  <div key={c.iso} className={cn('min-h-24 border-b border-l p-1 first:border-l-0 sm:min-h-28', !c.inMonth && 'bg-[var(--muted)]/30', isToday && 'bg-teal-50/60 dark:bg-teal-950/20')}>
                    <div className={cn('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold', isToday ? 'bg-teal-600 text-white' : c.inMonth ? '' : 'text-[var(--muted-foreground)] opacity-60')}>
                      {c.date.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {evs.slice(0, 3).map((e, i) => (
                        <Link
                          key={i}
                          href={`/tai-san/${e.assetId}`}
                          className={cn('block truncate rounded px-1 py-0.5 text-[10px] font-medium text-white', e.projected && 'opacity-70')}
                          style={{ backgroundColor: KIND[e.kind].color, borderStyle: e.projected ? 'dashed' : 'solid', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' }}
                          title={`${KIND[e.kind].label}${e.projected ? ' (dự kiến)' : ''}: ${e.code} — ${e.name} · ${e.department}`}
                        >
                          {e.code}
                        </Link>
                      ))}
                      {evs.length > 3 && <div className="px-1 text-[9px] text-[var(--muted-foreground)]">+{evs.length - 3} nữa…</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Lịch chi tiết + quá hạn */}
          <div className="space-y-3">
            {d.overdue.length > 0 && (
              <Card className="overflow-hidden border-red-200 dark:border-red-900">
                <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  <span className="inline-flex items-center gap-1.5"><AlertTriangle className="size-4" /> QUÁ HẠN ({d.overdue.length})</span>
                </div>
                <div className="thin-scroll max-h-64 overflow-y-auto">
                  {d.overdue.map((e, i) => (
                    <Link key={i} href={`/tai-san/${e.assetId}`} className="flex items-center gap-2 border-b px-4 py-2 text-xs last:border-0 hover:bg-red-50/50 dark:hover:bg-red-950/20">
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: KIND[e.kind].color }}>
                        {e.kind === 'calibration' ? <Shield className="size-3.5" /> : <Wrench className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{e.code} — {e.name}</div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">{e.department} · {KIND[e.kind].label}</div>
                      </div>
                      <span className="shrink-0 font-bold text-red-600">{e.daysLeft < 0 ? `${-e.daysLeft}d trễ` : ''}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
            <Card className="overflow-hidden">
              <div className="border-b px-4 py-2.5 text-sm font-semibold">
                Trong {cursor.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })} ({d.events.length} việc · {d.counts.assets} tài sản)
              </div>
              <div className="thin-scroll max-h-[560px] overflow-y-auto">
                {d.events.map((e, i) => (
                  <Link key={i} href={`/tai-san/${e.assetId}`} className="flex items-center gap-2 border-b px-4 py-2 text-xs last:border-0 hover:bg-[var(--muted)]/40">
                    <div className={cn('flex w-12 shrink-0 flex-col items-center rounded-lg py-1 text-white', e.projected && 'opacity-70')} style={{ backgroundColor: KIND[e.kind].color }}>
                      <span className="text-sm font-bold leading-none">{e.date.slice(8)}</span>
                      <span className="text-[9px] leading-tight">{`Th${Number(e.date.slice(5, 7))}`}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.code} — {e.name}</div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        {KIND[e.kind].label}{e.projected ? ' (dự kiến lần sau)' : ''} · {e.department}{e.location ? ` · ${e.location}` : ''}
                      </div>
                    </div>
                    <span className={cn('shrink-0 text-[10px] font-semibold', e.date < today ? 'text-red-600' : e.daysLeft <= 15 ? 'text-amber-600' : 'text-[var(--muted-foreground)]')}>
                      {e.date < today ? `quá ${-e.daysLeft}d` : e.daysLeft === 0 ? 'hôm nay' : `còn ${e.daysLeft}d`}
                    </span>
                  </Link>
                ))}
                {d.events.length === 0 && <div className="p-8 text-center text-xs text-[var(--muted-foreground)]">Không có việc nào trong tháng này</div>}
              </div>
            </Card>
            <Button variant="outline" className="w-full" onClick={downloadIcs}>
              <Download className="size-4" /> Dùng lại ở Outlook / Google Calendar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
