'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, Play, Plus, ScanLine, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AssetSubnav, Pill } from '@/components/assets/asset-ui';
import { InventoryFormDialog } from '@/components/assets/inventory-form';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { money, pct } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { INVENTORY_STATUS, type InventoryRow } from '@/lib/inventory';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

/** Thanh tiến độ kiểm kê */
function Progress({ row }: { row: InventoryRow }) {
  const s = row.stats;
  const done = !!s.expected && s.pending === 0 && s.checked === s.expected;
  const p = s.expected ? Math.min(100, Math.round((s.checked / s.expected) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[var(--muted-foreground)]">{s.expected ? `${s.checked}/${s.expected} đã kiểm` : 'Chưa chốt sổ'}</span>
        <span className={cn('font-bold', done ? 'text-green-600' : 'text-teal-700 dark:text-teal-400')}>{s.expected ? pct(s.checked, s.expected) : 0}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div className={cn('h-full rounded-full transition-all', done ? 'bg-green-600' : 'bg-teal-600')} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function ResultChips({ row }: { row: InventoryRow }) {
  const s = row.stats;
  if (!s.expected) return null;
  const items = [
    ['KHOP', s.KHOP],
    ['SAI_VI_TRI', s.SAI_VI_TRI],
    ['SAI_TINH_TRANG', s.SAI_TINH_TRANG],
    ['THIEU', s.THIEU],
    ['THUA', s.THUA + s.KHONG_RO],
  ] as const;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.filter(([, n]) => n > 0).length === 0 && <span className="text-[11px] italic text-[var(--muted-foreground)]">Chưa có số liệu</span>}
      {items
        .filter(([, n]) => n > 0)
        .map(([k, n]) => (
          <span key={k} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: INVENTORY_STATUS_COL[k], backgroundColor: `${INVENTORY_STATUS_COL[k]}14`, boxShadow: `inset 0 0 0 1px ${INVENTORY_STATUS_COL[k]}30` }}>
            {RESULT_LABEL[k]}: {n}
          </span>
        ))}
      {s.THIEU > 0 && (
        <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/40">
          <AlertTriangle className="mr-0.5 inline size-2.5" /> Giá trị thiếu {money(s.missingCost)} đ
        </span>
      )}
    </div>
  );
}
const RESULT_LABEL: Record<string, string> = { KHOP: 'Khớp', SAI_VI_TRI: 'Sai vị trí', SAI_TINH_TRANG: 'Khác T.Trạng', THIEU: 'Thiếu', THUA: 'Thừa' };
const INVENTORY_STATUS_COL: Record<string, string> = { KHOP: '#16a34a', SAI_VI_TRI: '#2563eb', SAI_TINH_TRANG: '#d97706', THIEU: '#dc2626', THUA: '#9333ea' };

export default function InventoryListPage() {
  const can = useAuth((s) => s.can);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('DANG_KIEM_KE');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const query = useQuery({
    queryKey: ['asset-inventories', q, status],
    queryFn: () =>
      apiFetch<{ items: InventoryRow[]; total: number; counts: Record<string, number> }>(
        `/asset-inventories?pageSize=50&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`,
      ),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') (document.getElementById('inv-search') as HTMLInputElement)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const { data } = query;
  const counts = data?.counts ?? {};
  const tabs: [string, string][] = [
    ['DANG_KIEM_KE', 'Đang kiểm kê'],
    ['NHAP', 'Nháp'],
    ['CHO_DUYET', 'Chờ duyệt'],
    ['HOAN_TAT', 'Hoàn tất'],
    ['DA_HUY', 'Đã huỷ'],
    ['', 'Tất cả'],
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>}
        title="Kiểm kê tài sản"
        description="Lập đợt kiểm kê, quét mã vạch/QR (tại chỗ hoặc offline), đối chiếu sổ sách, xử lý chênh lệch và in biên bản."
        actions={
          can('asset.inventory.manage') ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" /> Lập đợt kiểm kê
            </Button>
          ) : undefined
        }
      />
      <AssetSubnav />

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              status === k ? 'bg-teal-600 text-white shadow-sm' : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            {label}
            {counts[k] ? <span className="ml-1 opacity-80">({counts[k]})</span> : null}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            id="inv-search"
            placeholder="Tìm theo tên / mã đợt…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-56 rounded-lg border bg-transparent pl-8 pr-7 text-sm focus-visible:border-teal-500 focus-visible:outline-none"
          />
          {q && (
            <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" onClick={() => setQ('')} aria-label="Xoá tìm kiếm">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((row) => {
            const s = INVENTORY_STATUS[row.status] ?? INVENTORY_STATUS.NHAP;
            return (
              <div key={row.id} className="group cursor-pointer rounded-[var(--radius-card)] border bg-[var(--card)] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md" onClick={() => router.push(`/tai-san/kiem-ke/${row.id}`)} role="link">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{row.name}</span>
                      {row.blind && <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-950">MÙ</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {row.code} · {row.createdByName}
                    </div>
                  </div>
                  <Pill color={s.color}>{s.label}</Pill>
                </div>
                <div className="mt-2 line-clamp-2 min-h-[24px] text-xs text-[var(--muted-foreground)]">{row.scopeText}</div>
                <div className="mt-2">
                  <Progress row={row} />
                </div>
                <ResultChips row={row} />
                <div className="mt-3 flex items-center justify-between border-t pt-2 text-[11px] text-[var(--muted-foreground)]">
                  <span>{row.snapshotAt ? `Chốt sổ ${formatDateTime(row.snapshotAt)}` : row.plannedDate ? `Dự kiến ${formatDate(row.plannedDate)}` : ''}</span>
                  <span className="inline-flex items-center gap-2">
                    {row.can.scan && (
                      <Link
                        href={`/tai-san/kiem-ke/${row.id}/quet`}
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline dark:text-teal-400"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ScanLine className="size-3.5" /> Quét
                      </Link>
                    )}
                    {row.can.start && (
                      <Link href={`/tai-san/kiem-ke/${row.id}`} className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                        <Play className="size-3.5" /> Bắt đầu
                      </Link>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <ClipboardList className="size-10 text-[var(--muted-foreground)]" />
          <div className="text-sm text-[var(--muted-foreground)]">
            {q ? `Không có đợt kiểm kê nào khớp “${q}”` : 'Chưa có đợt kiểm kê nào trong trạng thái này'}
          </div>
          {can('asset.inventory.manage') && !q && (
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" /> Lập đợt kiểm kê đầu tiên
            </Button>
          )}
        </Card>
      )}

      <InventoryFormDialog
        open={formOpen || !!editing}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={(id) => {
          setFormOpen(false);
          setEditing(null);
          router.push(`/tai-san/kiem-ke/${id}`);
        }}
      />
    </div>
  );
}
