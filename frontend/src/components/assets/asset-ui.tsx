'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Boxes, CalendarClock, ClipboardCheck, ClipboardList, LayoutDashboard, Printer, ScanLine, Search, Settings2, TrendingDown, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { ASSET_STATUS, daysUntil, money, TX_STATUS, type AssetRow } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

/* ------------------------------------------------------------ Nhãn trạng thái */
export function Pill({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', className)}
      style={{ color, backgroundColor: `${color}1a`, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export const AssetStatus = ({ status }: { status: string }) => {
  const s = ASSET_STATUS[status] ?? { label: status, color: '#64748b' };
  return <Pill color={s.color}>{s.label}</Pill>;
};

export const TxStatus = ({ status }: { status: string }) => {
  const s = TX_STATUS[status] ?? { label: status, color: '#64748b' };
  return <Pill color={s.color}>{s.label}</Pill>;
};

/** Hạn (kiểm định/bảo dưỡng/bảo hành): đỏ quá hạn · cam ≤ 30 ngày · xám còn xa */
export function DueBadge({ date, empty = '—' }: { date?: string | null; empty?: string }) {
  const d = daysUntil(date);
  if (d === null) return <span className="text-[var(--muted-foreground)]">{empty}</span>;
  const color = d < 0 ? '#dc2626' : d <= 30 ? '#d97706' : '#64748b';
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{formatDate(date)}</span>
      <span className="text-[10px] font-semibold" style={{ color }}>
        {d < 0 ? `quá ${-d} ngày` : d === 0 ? 'hôm nay' : `còn ${d} ngày`}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ Thẻ số liệu */
export function Kpi({
  label,
  value,
  hint,
  icon,
  color = '#0d9488',
  href,
  progress,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  color?: string;
  href?: string;
  progress?: number;
}) {
  const body = (
    <div className="group relative h-full overflow-hidden rounded-xl border bg-[var(--card)] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-10 transition-transform group-hover:scale-110" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-[var(--muted-foreground)]">{label}</div>
        <div className="grid size-8 place-items-center rounded-lg text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
          {icon}
        </div>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {progress !== undefined ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: color }} />
        </div>
      ) : null}
      {hint ? <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/* ------------------------------------------------------------ Điều hướng phân hệ */
const SUBNAV = [
  { href: '/tai-san', label: 'Tổng quan', icon: LayoutDashboard, perm: ['asset.dashboard', 'asset.view'] },
  { href: '/tai-san/danh-sach', label: 'Danh sách', icon: Boxes, perm: ['asset.view'] },
  { href: '/tai-san/nghiep-vu', label: 'Chứng từ', icon: ClipboardCheck, perm: ['asset.transaction.view'] },
  { href: '/tai-san/kiem-ke', label: 'Kiểm kê', icon: ClipboardList, perm: ['asset.inventory.view', 'asset.inventory.scan', 'asset.inventory.manage'] },
  { href: '/tai-san/khau-hao', label: 'Khấu hao', icon: TrendingDown, perm: ['asset.depreciation.view'] },
  { href: '/tai-san/bao-tri', label: 'Lịch bảo trì', icon: CalendarClock, perm: ['asset.view'] },
  { href: '/tai-san/bao-cao', label: 'Báo cáo', icon: BarChart3, perm: ['asset.report.view'] },
  { href: '/tai-san/in-tem', label: 'In tem', icon: Printer, perm: ['asset.label.print'] },
  { href: '/tai-san/tra-cuu', label: 'Quét mã', icon: ScanLine, perm: ['asset.view'] },
  { href: '/tai-san/danh-muc', label: 'Danh mục', icon: Settings2, perm: ['asset.catalog.view'] },
];

export function AssetSubnav() {
  const pathname = usePathname();
  const can = useAuth((s) => s.can);
  const items = SUBNAV.filter((i) => i.perm.some((p) => can(p)));
  const active = (href: string) => (href === '/tai-san' ? pathname === '/tai-san' : pathname.startsWith(href));
  return (
    <div className="thin-scroll -mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors',
            active(i.href)
              ? 'bg-teal-600 font-semibold text-white shadow-sm'
              : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
          )}
        >
          <i.icon className="size-4" />
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Chọn tài sản */
/**
 * Hộp chọn tài sản cho chứng từ: tìm theo mã/tên/serial, lọc theo trạng thái hợp lệ,
 * hoặc quét mã vạch liên tục (máy quét dạng bàn phím: gõ mã + Enter).
 */
export function AssetPicker({
  open,
  onClose,
  onPick,
  allowedStatuses,
  exclude = [],
  title = 'Chọn tài sản',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (rows: AssetRow[]) => void;
  allowedStatuses?: string[];
  exclude?: number[];
  title?: string;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<Map<number, AssetRow>>(new Map());
  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) {
      setPicked(new Map());
      setScanMsg(null);
    }
  }, [open]);
  const status = allowedStatuses?.join(',') ?? 'ACTIVE';
  const { data, isFetching } = useQuery({
    queryKey: ['asset-picker', debounced, status],
    queryFn: () => apiFetch<{ items: AssetRow[]; total: number }>(`/assets?pageSize=50&sortBy=code&sortDir=asc&status=${status}&q=${encodeURIComponent(debounced)}`),
    enabled: open,
  });
  const ex = useMemo(() => new Set(exclude), [exclude]);
  const rows = (data?.items ?? []).filter((r) => !ex.has(r.id));
  const toggle = (r: AssetRow) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r);
      return n;
    });
  const onScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setScan('');
    try {
      const a = await apiFetch<AssetRow>(`/assets/lookup/${encodeURIComponent(code)}`);
      if (ex.has(a.id) || picked.has(a.id)) return setScanMsg({ ok: false, text: `${a.code} đã có trong danh sách` });
      if (allowedStatuses && !allowedStatuses.includes(a.status)) {
        return setScanMsg({ ok: false, text: `${a.code} đang "${ASSET_STATUS[a.status]?.label}" — không hợp lệ cho chứng từ này` });
      }
      setPicked((m) => new Map(m).set(a.id, a));
      setScanMsg({ ok: true, text: `✓ ${a.code} — ${a.name}` });
    } catch (e) {
      setScanMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      description={allowedStatuses ? `Chỉ hiện tài sản đang: ${allowedStatuses.map((s) => ASSET_STATUS[s]?.label ?? s).join(', ')}` : undefined}
      footer={
        <>
          <span className="mr-auto text-sm text-[var(--muted-foreground)]">Đã chọn {picked.size} tài sản</span>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={!picked.size} onClick={() => (onPick([...picked.values()]), onClose())}>
            Thêm {picked.size || ''} tài sản
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input autoFocus className="pl-8" placeholder="Tìm mã, tên, serial…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="relative">
            <ScanLine className="absolute left-2.5 top-2.5 size-4 text-teal-600" />
            <Input
              className="pl-8"
              placeholder="Quét mã vạch / QR rồi Enter…"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onScan())}
            />
          </div>
        </div>
        {scanMsg ? <div className={cn('rounded-lg px-3 py-1.5 text-xs', scanMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{scanMsg.text}</div> : null}
        {picked.size ? (
          <div className="flex flex-wrap gap-1.5">
            {[...picked.values()].map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-800 ring-1 ring-teal-200">
                <span className="font-mono">{r.code}</span>
                <button type="button" onClick={() => toggle(r)} aria-label="Bỏ chọn">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="thin-scroll max-h-[50vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--muted)] text-left text-xs">
              <tr>
                <th className="w-8 p-2" />
                <th className="p-2">Mã</th>
                <th className="p-2">Tên tài sản</th>
                <th className="p-2">Khoa/phòng</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2 text-right">Nguyên giá</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => toggle(r)} className={cn('cursor-pointer border-t hover:bg-[var(--muted)]', picked.has(r.id) && 'bg-teal-50/70')}>
                  <td className="p-2">
                    <input type="checkbox" readOnly checked={picked.has(r.id)} className="accent-teal-600" />
                  </td>
                  <td className="p-2 font-mono text-xs">{r.code}</td>
                  <td className="p-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{[r.model, r.serialNumber && `S/N ${r.serialNumber}`].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="p-2 text-xs">{r.departmentName ?? 'Kho'}</td>
                  <td className="p-2">
                    <AssetStatus status={r.status} />
                  </td>
                  <td className="p-2 text-right tabular-nums">{money(r.originalCost)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-[var(--muted-foreground)]">
                    {isFetching ? 'Đang tải…' : 'Không có tài sản phù hợp'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}

/** Ô thông tin nhãn–giá trị trong trang chi tiết */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-0.5 break-words text-sm">{children || <span className="text-[var(--muted-foreground)]">—</span>}</div>
    </div>
  );
}
