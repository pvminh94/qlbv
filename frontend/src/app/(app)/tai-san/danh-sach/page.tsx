'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, FileInput, Filter, Plus, Printer, RotateCcw, Search, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AssetFormDialog } from '@/components/assets/asset-form';
import { AssetImportDialog } from '@/components/assets/asset-import';
import { AssetStatus, AssetSubnav, DueBadge } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { apiFetch, downloadFile } from '@/lib/api';
import { ASSET_CONDITION, ASSET_STATUS, type AssetRow, money, moneyShort, pct, treeLabel, useAssetCatalog, useAssetMeta, useAssetOptions } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

interface ListRes {
  items: AssetRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
  summary: { total: number; cost: number; accumulated: number; bookValue: number };
}

const FILTER_KEYS = ['q', 'status', 'categoryId', 'departmentId', 'locationId', 'fundingSourceId', 'group', 'kind', 'condition', 'due', 'dueDays', 'costMin', 'costMax', 'acquiredFrom', 'acquiredTo', 'custodianId', 'sortBy', 'sortDir'] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

const COLUMNS = [
  { key: 'category', label: 'Loại' },
  { key: 'department', label: 'Khoa/phòng' },
  { key: 'location', label: 'Vị trí' },
  { key: 'custodian', label: 'Người giữ' },
  { key: 'serial', label: 'Model / Serial' },
  { key: 'acquisition', label: 'Ngày ghi tăng' },
  { key: 'funding', label: 'Nguồn vốn' },
  { key: 'cost', label: 'Nguyên giá' },
  { key: 'book', label: 'Giá trị còn lại' },
  { key: 'wear', label: '% hao mòn' },
  { key: 'calibration', label: 'Hạn kiểm định' },
  { key: 'maintenance', label: 'Hạn bảo dưỡng' },
  { key: 'condition', label: 'Tình trạng' },
] as const;
const DEFAULT_COLS = ['category', 'department', 'custodian', 'cost', 'book', 'wear', 'calibration'];
const COL_STORE = 'qlbs.asset.cols';

const STATUS_CHIPS = [
  { key: 'ACTIVE', label: 'Đang theo dõi' },
  { key: '', label: 'Tất cả' },
  ...Object.entries(ASSET_STATUS).map(([key, s]) => ({ key, label: s.label })),
];

function SortTh({ label, col, f, onSort, className }: { label: string; col?: string; f: Filters; onSort: (c: string) => void; className?: string }) {
  const active = col && f.sortBy === col;
  return (
    <th className={cn('whitespace-nowrap p-2 font-medium', className)}>
      {col ? (
        <button type="button" onClick={() => onSort(col)} className={cn('inline-flex items-center gap-0.5 hover:text-teal-700', active && 'text-teal-700')}>
          {label}
          {active ? f.sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

function ListContent() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useAuth((s) => s.can);
  const meta = useAssetMeta();
  const cats = useAssetCatalog('categories');
  const locs = useAssetCatalog('locations');
  const funds = useAssetCatalog('funding');
  const opts = useAssetOptions();

  const initial = useMemo(() => {
    const f: Filters = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v !== null) f[k] = v;
    }
    if (!('status' in f) && !f.due) f.status = 'ACTIVE';
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [f, setF] = useState<Filters>(initial);
  const [q, setQ] = useState(initial.q ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [advanced, setAdvanced] = useState(Boolean(initial.costMin || initial.costMax || initial.acquiredFrom || initial.acquiredTo || initial.kind || initial.condition || initial.fundingSourceId || initial.locationId));
  const [selected, setSelected] = useState<Map<number, AssetRow>>(new Map());
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);
  const [colMenu, setColMenu] = useState(false);
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [txMenu, setTxMenu] = useState(false);
  const colRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_STORE) ?? 'null');
      if (Array.isArray(saved)) setCols(saved);
    } catch {
      /* bỏ qua */
    }
  }, []);
  // Ô tìm kiếm chung ở thanh trên gửi từ khoá sang khi đang đứng ở trang này
  useEffect(() => {
    const onSearch = (e: Event) => setQ(String((e as CustomEvent<string>).detail ?? ''));
    window.addEventListener('qlbs:asset-search', onSearch);
    return () => window.removeEventListener('qlbs:asset-search', onSearch);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setF((s) => (s.q === q ? s : { ...s, q })), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [f]);
  // Đồng bộ bộ lọc lên URL (chia sẻ link, quay lại giữ trạng thái)
  useEffect(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v);
    if (!f.status) sp.set('status', '');
    router.replace(`/tai-san/danh-sach?${sp.toString()}`, { scroll: false });
  }, [f, router]);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v);
    return sp.toString();
  }, [f]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['assets', qs, page, pageSize],
    queryFn: () => apiFetch<ListRes>(`/assets?${qs}&page=${page}&pageSize=${pageSize}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const set = (k: keyof Filters, v: string) => setF((s) => ({ ...s, [k]: v }));
  const onSort = (c: string) => setF((s) => ({ ...s, sortBy: c, sortDir: s.sortBy === c && s.sortDir === 'asc' ? 'desc' : 'asc' }));
  const reset = () => {
    setQ('');
    setF({ status: 'ACTIVE' });
  };
  const show = (c: string) => cols.includes(c);
  const toggleCol = (c: string) => {
    const next = cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c];
    setCols(next);
    localStorage.setItem(COL_STORE, JSON.stringify(next));
  };

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((r) => selected.has(r.id));
  const togglePage = () =>
    setSelected((m) => {
      const n = new Map(m);
      if (allOnPage) items.forEach((r) => n.delete(r.id));
      else items.forEach((r) => n.set(r.id, r));
      return n;
    });
  const toggle = (r: AssetRow) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r);
      return n;
    });

  const selIds = [...selected.keys()].join(',');
  const selRows = [...selected.values()];
  const txTypes = Object.entries(meta.data?.txTypes ?? {}).filter(([k]) => k !== 'GHI_TANG');
  const activeFilterCount = FILTER_KEYS.filter((k) => !['q', 'sortBy', 'sortDir', 'status'].includes(k) && f[k]).length;

  const exportExcel = async () => {
    try {
      await downloadFile(`/assets/export?${selected.size ? `ids=${selIds}` : qs}`, `danh-sach-tai-san-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const s = data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Danh sách tài sản"
        description="Hồ sơ toàn bộ tài sản, thiết bị: lọc sâu theo cây loại, vị trí, khoa, nguồn vốn, hạn kiểm định — chọn nhiều để lập chứng từ hoặc in tem."
        breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('asset.import') ? (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileInput className="size-4" /> Nhập Excel
              </Button>
            ) : null}
            {can('asset.export') ? (
              <Button variant="outline" onClick={exportExcel}>
                <Download className="size-4" /> Xuất Excel{selected.size ? ` (${selected.size})` : ''}
              </Button>
            ) : null}
            {can('asset.create') ? (
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setFormOpen(true)}>
                <Plus className="size-4" /> Thêm tài sản
              </Button>
            ) : null}
          </div>
        }
      />
      <AssetSubnav />

      {/* ---------------------------------------------------------- Bộ lọc */}
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input className="pl-8" placeholder="Tìm mã, tên, serial, model, người giữ, số lưu hành…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-52" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Tất cả loại tài sản</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {treeLabel(c)}
              </option>
            ))}
          </Select>
          <Select className="w-48" value={f.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value)}>
            <option value="">Tất cả khoa/phòng</option>
            <option value="-1">— Trong kho (chưa giao) —</option>
            {(opts.data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select className="w-44" value={f.due ?? ''} onChange={(e) => set('due', e.target.value)}>
            <option value="">Mọi thời hạn</option>
            <option value="calibration">Sắp/đã đến hạn kiểm định</option>
            <option value="maintenance">Sắp/đã đến hạn bảo dưỡng</option>
            <option value="warranty">Sắp hết bảo hành</option>
            <option value="overdue">Đã quá hạn</option>
          </Select>
          <Button variant={advanced || activeFilterCount ? 'subtle' : 'outline'} onClick={() => setAdvanced((v) => !v)}>
            <Filter className="size-4" /> Lọc nâng cao{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          <Button variant="ghost" onClick={reset} title="Xoá bộ lọc">
            <RotateCcw className="size-4" />
          </Button>
        </div>
        {advanced ? (
          <div className="grid gap-2 rounded-lg bg-[var(--muted)]/50 p-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={f.locationId ?? ''} onChange={(e) => set('locationId', e.target.value)}>
              <option value="">Mọi vị trí</option>
              {(locs.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {treeLabel(c)}
                </option>
              ))}
            </Select>
            <Select value={f.fundingSourceId ?? ''} onChange={(e) => set('fundingSourceId', e.target.value)}>
              <option value="">Mọi nguồn vốn</option>
              {(funds.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={f.group ?? ''} onChange={(e) => set('group', e.target.value)}>
              <option value="">Mọi nhóm</option>
              {Object.entries(meta.data?.groups ?? {}).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Select value={f.kind ?? ''} onChange={(e) => set('kind', e.target.value)}>
              <option value="">Mọi phân loại</option>
              {Object.entries(meta.data?.kinds ?? {}).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Select value={f.condition ?? ''} onChange={(e) => set('condition', e.target.value)}>
              <option value="">Mọi tình trạng</option>
              {Object.entries(ASSET_CONDITION).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Select value={f.custodianId ?? ''} onChange={(e) => set('custodianId', e.target.value)}>
              <option value="">Mọi người giữ</option>
              {(opts.data?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1">
              <Input type="number" placeholder="Nguyên giá từ" value={f.costMin ?? ''} onChange={(e) => set('costMin', e.target.value)} />
              <span className="text-xs">–</span>
              <Input type="number" placeholder="đến" value={f.costMax ?? ''} onChange={(e) => set('costMax', e.target.value)} />
            </div>
            <div className="flex items-center gap-1">
              <Input type="date" title="Ghi tăng từ ngày" value={f.acquiredFrom ?? ''} onChange={(e) => set('acquiredFrom', e.target.value)} />
              <span className="text-xs">–</span>
              <Input type="date" title="đến ngày" value={f.acquiredTo ?? ''} onChange={(e) => set('acquiredTo', e.target.value)} />
            </div>
            {f.due ? (
              <Select value={f.dueDays ?? '30'} onChange={(e) => set('dueDays', e.target.value)}>
                {[7, 15, 30, 60, 90, 180].map((d) => (
                  <option key={d} value={d}>
                    Trong {d} ngày tới
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        ) : null}
        <div className="thin-scroll flex gap-1 overflow-x-auto">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key || 'all'}
              type="button"
              onClick={() => set('status', c.key)}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
                (f.status ?? '') === c.key ? 'border-teal-600 bg-teal-600 text-white' : 'bg-[var(--card)] hover:border-teal-400',
              )}
            >
              {ASSET_STATUS[c.key] ? <span className="size-2 rounded-full" style={{ background: ASSET_STATUS[c.key].color }} /> : null}
              {c.label}
            </button>
          ))}
        </div>
      </Card>

      {/* ---------------------------------------------------------- Tổng hợp */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { l: 'Số tài sản', v: (s?.total ?? 0).toLocaleString('vi-VN'), sub: 'theo bộ lọc hiện tại', c: 'text-teal-700' },
          { l: 'Tổng nguyên giá', v: moneyShort(s?.cost), sub: `${money(s?.cost)} đ`, c: 'text-slate-800' },
          { l: 'Hao mòn luỹ kế', v: moneyShort(s?.accumulated), sub: `${pct(s?.accumulated ?? 0, s?.cost ?? 0)}% nguyên giá`, c: 'text-amber-700' },
          { l: 'Giá trị còn lại', v: moneyShort(s?.bookValue), sub: `${money(s?.bookValue)} đ`, c: 'text-emerald-700' },
        ].map((k) => (
          <Card key={k.l} className="px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{k.l}</div>
            <div className={cn('text-xl font-bold tabular-nums', k.c)}>{k.v}</div>
            <div className="truncate text-[11px] text-[var(--muted-foreground)]">{k.sub}</div>
          </Card>
        ))}
      </div>

      {/* ---------------------------------------------------------- Thanh thao tác hàng loạt */}
      {selected.size ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-3 py-2 shadow-sm">
          <span className="text-sm font-semibold text-teal-800">Đã chọn {selected.size} tài sản</span>
          <span className="text-xs text-teal-700">· nguyên giá {moneyShort(selRows.reduce((a, r) => a + Number(r.originalCost), 0))}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {can('asset.transaction.create') ? (
              <div className="relative">
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setTxMenu((v) => !v)}>
                  <Send className="size-4" /> Lập chứng từ
                </Button>
                {txMenu ? (
                  <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border bg-[var(--card)] p-1 shadow-xl" onMouseLeave={() => setTxMenu(false)}>
                    {txTypes.map(([k, t]) => {
                      const ok = selRows.filter((r) => t.allowed.includes(r.status)).length;
                      return (
                        <button
                          key={k}
                          type="button"
                          disabled={!ok}
                          onClick={() => router.push(`/tai-san/nghiep-vu/tao-moi?type=${k}&ids=${selRows.filter((r) => t.allowed.includes(r.status)).map((r) => r.id).join(',')}`)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span>{t.label}</span>
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            {ok}/{selected.size} hợp lệ
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {can('asset.label.print') ? (
              <Button size="sm" variant="outline" onClick={() => router.push(`/tai-san/in-tem?ids=${selIds}`)}>
                <Printer className="size-4" /> In tem
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
              <X className="size-4" /> Bỏ chọn
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- Bảng */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-xs text-[var(--muted-foreground)]">
            {isFetching ? 'Đang tải…' : `${data?.total ?? 0} tài sản`} · trang {page}/{totalPages}
          </div>
          <div className="relative" ref={colRef}>
            <Button size="sm" variant="ghost" onClick={() => setColMenu((v) => !v)}>
              <Columns3 className="size-4" /> Cột hiển thị
            </Button>
            {colMenu ? (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border bg-[var(--card)] p-2 shadow-xl" onMouseLeave={() => setColMenu(false)}>
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--muted)]">
                    <input type="checkbox" className="accent-teal-600" checked={show(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.label}
                  </label>
                ))}
                <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-teal-700 hover:bg-teal-50" onClick={() => (setCols(DEFAULT_COLS), localStorage.removeItem(COL_STORE))}>
                  Khôi phục mặc định
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="w-8 p-2">
                  <input type="checkbox" className="accent-teal-600" checked={allOnPage} onChange={togglePage} aria-label="Chọn cả trang" />
                </th>
                <SortTh label="Mã" col="code" f={f} onSort={onSort} />
                <SortTh label="Tên tài sản" col="name" f={f} onSort={onSort} />
                {show('category') ? <SortTh label="Loại" col="categoryName" f={f} onSort={onSort} /> : null}
                {show('serial') ? <SortTh label="Model / Serial" f={f} onSort={onSort} /> : null}
                {show('department') ? <SortTh label="Khoa/phòng" col="departmentName" f={f} onSort={onSort} /> : null}
                {show('location') ? <SortTh label="Vị trí" f={f} onSort={onSort} /> : null}
                {show('custodian') ? <SortTh label="Người giữ" f={f} onSort={onSort} /> : null}
                {show('acquisition') ? <SortTh label="Ghi tăng" col="acquisitionDate" f={f} onSort={onSort} /> : null}
                {show('funding') ? <SortTh label="Nguồn vốn" f={f} onSort={onSort} /> : null}
                {show('cost') ? <SortTh label="Nguyên giá" col="originalCost" f={f} onSort={onSort} className="text-right" /> : null}
                {show('book') ? <SortTh label="Còn lại" col="bookValue" f={f} onSort={onSort} className="text-right" /> : null}
                {show('wear') ? <SortTh label="Hao mòn" f={f} onSort={onSort} /> : null}
                {show('calibration') ? <SortTh label="Kiểm định" col="nextCalibrationDate" f={f} onSort={onSort} /> : null}
                {show('maintenance') ? <SortTh label="Bảo dưỡng" col="nextMaintenanceDate" f={f} onSort={onSort} /> : null}
                {show('condition') ? <SortTh label="Tình trạng" f={f} onSort={onSort} /> : null}
                <SortTh label="Trạng thái" col="status" f={f} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={20} className="p-2">
                        <Skeleton className="h-6" />
                      </td>
                    </tr>
                  ))
                : items.map((r) => {
                    const wear = pct(Number(r.accumulatedDepreciation), Number(r.originalCost));
                    return (
                      <tr key={r.id} className={cn('border-t transition-colors hover:bg-teal-50/40', selected.has(r.id) && 'bg-teal-50/70')}>
                        <td className="p-2">
                          <input type="checkbox" className="accent-teal-600" checked={selected.has(r.id)} onChange={() => toggle(r)} aria-label={`Chọn ${r.code}`} />
                        </td>
                        <td className="whitespace-nowrap p-2">
                          <Link href={`/tai-san/${r.id}`} className="font-mono text-xs font-semibold text-teal-700 hover:underline">
                            {r.code}
                          </Link>
                        </td>
                        <td className="min-w-[200px] p-2">
                          <Link href={`/tai-san/${r.id}`} className="font-medium hover:text-teal-700">
                            {r.name}
                          </Link>
                          {r.tags?.length ? (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {r.tags.slice(0, 3).map((t) => (
                                <span key={t} className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        {show('category') ? <td className="p-2 text-xs">{r.categoryName ?? '—'}</td> : null}
                        {show('serial') ? (
                          <td className="p-2 text-xs">
                            <div>{r.model || '—'}</div>
                            {r.serialNumber ? <div className="font-mono text-[10.5px] text-[var(--muted-foreground)]">S/N {r.serialNumber}</div> : null}
                          </td>
                        ) : null}
                        {show('department') ? <td className="p-2 text-xs">{r.departmentName ?? <span className="text-slate-500">Kho</span>}</td> : null}
                        {show('location') ? <td className="p-2 text-xs">{r.locationName ?? '—'}</td> : null}
                        {show('custodian') ? <td className="p-2 text-xs">{r.custodianName || '—'}</td> : null}
                        {show('acquisition') ? <td className="whitespace-nowrap p-2 text-xs">{r.acquisitionDate ? formatDate(r.acquisitionDate) : '—'}</td> : null}
                        {show('funding') ? <td className="p-2 text-xs">{r.fundingSourceName ?? '—'}</td> : null}
                        {show('cost') ? <td className="whitespace-nowrap p-2 text-right tabular-nums">{money(r.originalCost)}</td> : null}
                        {show('book') ? <td className="whitespace-nowrap p-2 text-right font-medium tabular-nums text-emerald-700">{money(r.bookValue)}</td> : null}
                        {show('wear') ? (
                          <td className="p-2">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, wear)}%`, background: wear >= 100 ? '#64748b' : wear > 75 ? '#d97706' : '#0d9488' }} />
                              </div>
                              <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{wear}%</span>
                            </div>
                          </td>
                        ) : null}
                        {show('calibration') ? (
                          <td className="p-2">
                            <DueBadge date={r.nextCalibrationDate} />
                          </td>
                        ) : null}
                        {show('maintenance') ? (
                          <td className="p-2">
                            <DueBadge date={r.nextMaintenanceDate} />
                          </td>
                        ) : null}
                        {show('condition') ? <td className="p-2 text-xs">{ASSET_CONDITION[r.condition] ?? r.condition}</td> : null}
                        <td className="p-2">
                          <AssetStatus status={r.status} />
                        </td>
                      </tr>
                    );
                  })}
              {!isLoading && !items.length ? (
                <tr>
                  <td colSpan={20} className="p-10 text-center text-sm text-[var(--muted-foreground)]">
                    Không có tài sản phù hợp bộ lọc.{' '}
                    <button type="button" className="text-teal-700 underline" onClick={reset}>
                      Xoá bộ lọc
                    </button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            Hiển thị
            <Select className="h-8 w-20" value={String(pageSize)} onChange={(e) => (setPageSize(Number(e.target.value)), setPage(1))}>
              {[20, 50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            / trang
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 tabular-nums">
              {page} / {totalPages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </Card>

      <AssetFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(res) => {
          const r = res as { id?: number };
          if (r?.id) router.push(`/tai-san/${r.id}`);
        }}
      />
      <AssetImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

export default function AssetListPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ListContent />
    </Suspense>
  );
}
