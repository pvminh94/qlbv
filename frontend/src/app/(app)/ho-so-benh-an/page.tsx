'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileDown,
  Filter,
  FilterX,
  PenLine,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch, openFileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatNumber, toList } from '@/lib/utils';
import type { Paginated } from '@/types/api';

interface HsbaRow {
  id: number;
  code: string;
  status: string;
  statusLabel?: string;
  pendingStepKey: string | null;
  pendingStepName?: string | null;
  patientName: string;
  patientBirthYear: string | null;
  patientGender: string | null;
  maKcb: string | null;
  maTheBhyt: string | null;
  ngayVaoVien: string | null;
  ngayRaVien: string | null;
  requesterName: string;
  departmentName: string | null;
  amount: string | null;
  priority: string | null;
  returnCount: number;
  updatedAt: string;
  canSign?: boolean;
  /** Số giờ phiếu đang dậm chân tại bước hiện tại (BE tính sẵn) */
  waitingHours?: number;
  /** Vượt SLA hiển thị theo mức ưu tiên (BE tính sẵn) */
  overdue?: boolean;
}

interface WorkflowStepOption {
  key: string;
  name: string;
  title?: string;
}

interface WorkflowOption {
  id: number;
  code: string;
  name: string;
  isDefault: boolean;
  departmentId: number | null;
  steps: WorkflowStepOption[];
}

/**
 * Các tab trạng thái suy ra từ bước của quy trình ký thật:
 * bước `TAICHINH` → trạng thái `CHO_TAICHINH`. Nhờ vậy thêm/bớt bước trong
 * trang Quy trình ký là danh sách tự cập nhật, không phải sửa mã nguồn.
 */
function buildStatusTabs(steps: WorkflowStepOption[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const stepTabs = steps
    .filter((step) => {
      if (seen.has(step.key)) return false;
      seen.add(step.key);
      return true;
    })
    .map((step) => ({ value: `CHO_${step.key}`, label: `Chờ ${step.name}` }));
  return [
    { value: '', label: 'Tất cả' },
    ...stepTabs,
    { value: 'HOAN_TAT', label: 'Hoàn tất' },
    { value: 'TRA_LAI', label: 'Bị trả lại' },
    { value: 'DA_HUY', label: 'Đã hủy' },
  ];
}

function RequestsContent() {
  const params = useSearchParams();
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  /** Ký nhanh: chỉ hiện khi ngườI dùng có ít nhất một quyền ký */
  const canSomeSign = useMemo(() => {
    try {
      return (
        can('hsba.request.sign-requester') ||
        can('hsba.request.sign-khtb') ||
        can('hsba.request.sign-insurance') ||
        can('hsba.request.sign-finance')
      );
    } catch {
      return false;
    }
  }, [can]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [myTurn, setMyTurn] = useState(false);
  const [mine, setMine] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [priority, setPriority] = useState('');
  const [amountFrom, setAmountFrom] = useState('');
  const [amountTo, setAmountTo] = useState('');
  const [doiTuong, setDoiTuong] = useState('');
  const [returnedOnly, setReturnedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('createdAt');

  // Đồng bộ từ khoá tìm kiếm toàn cục (?q=) mỗi khi URL đổi — kể cả khi đang ở sẵn trang này
  const qParam = params.get('q') ?? '';
  useEffect(() => {
    setKeyword(qParam);
    setSearch(qParam);
    setPage(1);
  }, [qParam]);

  const { data: departmentOptions } = useQuery({
    queryKey: ['departments-options'],
    queryFn: () => apiFetch<{ id: number; name: string; level: number }[]>('/departments/options'),
  });

  const { data: workflows } = useQuery({
    queryKey: ['hsba-workflows'],
    queryFn: () => apiFetch<unknown>('/hsba/workflows?pageSize=200').then((d) => toList<WorkflowOption>(d)),
  });

  const statusTabs = buildStatusTabs(
    (workflows ?? []).find((w) => w.isDefault)?.steps ?? workflows?.[0]?.steps ?? [],
  );

  const advancedCount = [
    departmentId,
    priority,
    amountFrom,
    amountTo,
    doiTuong,
    returnedOnly ? 'x' : '',
  ].filter(Boolean).length;

  const clearAdvanced = (): void => {
    setDepartmentId('');
    setPriority('');
    setAmountFrom('');
    setAmountTo('');
    setDoiTuong('');
    setReturnedOnly(false);
    setPage(1);
  };

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', '20');
    if (search) p.set('q', search);
    if (status) p.set('status', status);
    if (myTurn) p.set('myTurn', 'true');
    if (mine) p.set('mine', 'true');
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (departmentId) p.set('departmentId', departmentId);
    if (sortBy !== 'createdAt') p.set('sortBy', sortBy);
    const filters: string[] = [];
    if (priority) filters.push(`priority:eq:${priority}`);
    if (doiTuong) filters.push(`doiTuong:eq:${doiTuong}`);
    if (amountFrom) filters.push(`amount:gte:${amountFrom}`);
    if (amountTo) filters.push(`amount:lte:${amountTo}`);
    if (returnedOnly) filters.push('returnCount:gt:0');
    if (filters.length) p.set('filters', filters.join(','));
    return p.toString();
  }, [page, search, status, myTurn, mine, dateFrom, dateTo, departmentId, priority, amountFrom, amountTo, doiTuong, returnedOnly, sortBy]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['hsba-requests', query],
    queryFn: () => apiFetch<Paginated<HsbaRow>>(`/hsba/requests?${query}`),
  });

  const { data: stats } = useQuery({
    queryKey: ['hsba-stats'],
    queryFn: () =>
      apiFetch<{
        totals: { total: number; pending: number; completed: number; returned: number; avgDays: string };
        statuses: { status: string; total: number }[];
      }>('/hsba/requests/stats'),
  });

  const statsMap = useMemo(
    () => Object.fromEntries((stats?.statuses ?? []).map((row) => [row.status, row.total])),
    [stats],
  );

  /** Có ít nhất một điều kiện lọc đang chạy → hiện nút đặt lại tổng */
  const hasAnyFilter = !!(
    search ||
    status ||
    myTurn ||
    mine ||
    dateFrom ||
    dateTo ||
    departmentId ||
    priority ||
    amountFrom ||
    amountTo ||
    doiTuong ||
    returnedOnly ||
    sortBy !== 'createdAt'
  );

  const resetAllFilters = (): void => {
    setSearch('');
    setKeyword('');
    setStatus('');
    setMyTurn(false);
    setMine(false);
    setDateFrom('');
    setDateTo('');
    setSortBy('createdAt');
    clearAdvanced();
  };

  /** Các phiếu TREN TRANG hiện được ngườI xem đang có quyền ký → là bóng của cột chọn ký nhanh */
  const signableOnPage = useMemo(
    () => (data?.items ?? []).filter((r) => r.canSign).map((r) => r.id),
    [data],
  );
  const selectedOnPage = signableOnPage.filter((id) => selected.has(id));
  const allPageChecked = signableOnPage.length > 0 && selectedOnPage.length === signableOnPage.length;

  const toggleOne = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePage = (): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageChecked) signableOnPage.forEach((id) => next.delete(id));
      else signableOnPage.forEach((id) => next.add(id));
      return next;
    });
  };

  const bulkSign = useMutation({
    mutationFn: () =>
      apiFetch<{
        total: number;
        success: number;
        failed: number;
        results: { id: number; ok: boolean; message?: string; status?: string }[];
      }>('/hsba/requests/bulk-sign', {
        method: 'POST',
        body: { ids: [...selected], note: bulkNote.trim() || undefined },
      }),
    onSuccess: (resp) => {
      setSelected(new Set());
      setBulkNote('');
      // Nếu ký lỗi một số phiếu → giữ lại tick để ngườI dùng rà từng cái
      const failed = (resp?.results ?? []).filter((r) => !r.ok);
      if (failed.length) setSelected(new Set(failed.map((r) => r.id)));
      void queryClient.invalidateQueries({ queryKey: ['hsba-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['hsba-stats'] });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Phiếu đề nghị sửa hồ sơ bệnh án"
        description={
          (workflows ?? []).find((w) => w.isDefault) ?? workflows?.[0]
            ? `Quy trình ký: ${(((workflows ?? []).find((w) => w.isDefault) ?? workflows?.[0])?.steps ?? [])
                .map((st) => st.name)
                .join(' → ')}`
            : 'Quy trình ký điện tử nhiều bước'
        }
        actions={
          can('hsba.request.create') ? (
            <Link
              href="/ho-so-benh-an/tao-moi"
              className="inline-flex h-9.5 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
            >
              <PenLine className="size-4" /> Tạo phiếu mới
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tổng số phiếu" value={formatNumber(stats?.totals?.total ?? data?.total ?? 0)} icon={<ClipboardList className="size-4" />} tone="primary" />
        {/* Các bước xử lý lấy động theo quy trình thật — thêm/bớt bước trong trang
            Quy trình ký là thẻ thống kê tự cập nhật */}
        {(workflows ?? []).find((w) => w.isDefault)?.steps?.slice(1, 3).map((step) => (
          <StatCard
            key={step.key}
            label={`Chờ ${step.name.toLowerCase()}`}
            value={formatNumber(statsMap[`CHO_${step.key}`] ?? 0)}
            tone="warning"
          />
        ))}
        <StatCard label="Đã hoàn tất" value={formatNumber(statsMap.HOAN_TAT ?? 0)} icon={<ShieldCheck className="size-4" />} tone="success" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === tab.value
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]',
              )}
            >
              {tab.label}
              {tab.value && statsMap[tab.value] ? ` (${statsMap[tab.value]})` : ''}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(keyword.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Tên người bệnh, mã KCB, mã thẻ BHYT, số phiếu…"
              className="h-8.5 w-80 pl-8 text-sm"
            />
          </form>

          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={myTurn} onChange={(e) => { setMyTurn(e.target.checked); setPage(1); }} />
            Chờ tôi xử lý
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} />
            Phiếu của tôi
          </label>

          <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-8.5 w-34 text-sm" />
            <span>→</span>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-8.5 w-34 text-sm" />
          </div>

          <Select
            value=""
            onChange={(e) => {
              const [field, value] = e.target.value.split('|');
              if (!field) return;
              setKeyword('');
              setSearch('');
              setStatus(field === 'status' ? value : '');
            }}
            className="hidden"
            aria-hidden
          >
            <option value="">Bộ lọc nâng cao</option>
          </Select>

          <Button
            variant={showAdvanced ? 'default' : 'outline'}
            size="sm"
            className="ml-auto"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Filter /> Bộ lọc nâng cao
            {advancedCount > 0 ? (
              <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-semibold">
                {advancedCount}
              </span>
            ) : null}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} title="Tải lại">
            <RefreshCw className={cn(isFetching && 'animate-spin')} />
          </Button>
          {hasAnyFilter ? (
            <Button variant="ghost" size="sm" onClick={resetAllFilters} title="Đặt lại toàn bộ điều kiện lọc">
              <FilterX /> Xoá lọc
            </Button>
          ) : null}
        </div>

        {/* Thanh ký nhanh — chỉ nổi khi đã chọn phiếu mà ngườI dùng có quyền ký */}
        {canSomeSign && selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--primary)]/5 px-4 py-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)]">
              <CheckCheck className="size-4" /> Đã chọn {selected.size} phiếu
            </span>
            <Input
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              placeholder="Ghi chú ký chung (không bắt buộc)…"
              className="h-8.5 w-72 text-sm"
              maxLength={500}
            />
            <Button
              size="sm"
              disabled={bulkSign.isPending}
              onClick={() => bulkSign.mutate()}
            >
              {bulkSign.isPending ? 'Đang ký…' : `Ký nhanh ${selected.size} phiếu`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={bulkSign.isPending}>
              Bỏ chọn
            </Button>
            {bulkSign.isError ? (
              <span className="text-xs text-[var(--destructive,#b91c1c)]">Có lỗi khi ký — thử lại</span>
            ) : null}
            {bulkSign.isSuccess && bulkSign.data && bulkSign.data.failed > 0 ? (
              <span className="text-xs text-[var(--warning,#b45309)]">
                {bulkSign.data.success}/{bulkSign.data.total} phiếu đã ký — {bulkSign.data.failed} phiếu giữ lại để xử lý
              </span>
            ) : null}
          </div>
        ) : null}

        {showAdvanced ? (
          <div className="grid gap-3 border-b bg-[var(--muted)]/40 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Khoa đề nghị</label>
              <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} className="h-8.5 text-sm">
                <option value="">— Mọi khoa —</option>
                {(departmentOptions ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {'— '.repeat(Math.max(0, d.level - 1))}
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Mức ưu tiên</label>
              <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="h-8.5 text-sm">
                <option value="">— Tất cả —</option>
                <option value="URGENT">Khẩn cấp</option>
                <option value="HIGH">Ưu tiên</option>
                <option value="NORMAL">Bình thường</option>
                <option value="LOW">Thấp</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Đối tượng</label>
              <Select value={doiTuong} onChange={(e) => { setDoiTuong(e.target.value); setPage(1); }} className="h-8.5 text-sm">
                <option value="">— Tất cả —</option>
                <option value="BHYT">BHYT</option>
                <option value="Thu phí">Thu phí</option>
                <option value="Miễn">Miễn</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Sắp xếp theo</label>
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-8.5 text-sm">
                <option value="createdAt">Ngày tạo (mới nhất)</option>
                <option value="updatedAt">Cập nhật gần nhất</option>
                <option value="patientName">Tên người bệnh</option>
                <option value="code">Số phiếu</option>
                <option value="status">Trạng thái</option>
                <option value="ngayVaoVien">Ngày vào viện</option>
                <option value="amount">Số tiền</option>
                <option value="returnCount">Số lần bị trả lại</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Số tiền từ (đồng)</label>
              <Input value={amountFrom} onChange={(e) => { setAmountFrom(e.target.value.replace(/[^\d]/g, '')); setPage(1); }} placeholder="0" className="h-8.5 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Số tiền đến (đồng)</label>
              <Input value={amountTo} onChange={(e) => { setAmountTo(e.target.value.replace(/[^\d]/g, '')); setPage(1); }} placeholder="Không giới hạn" className="h-8.5 text-sm" />
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={returnedOnly} onChange={(e) => { setReturnedOnly(e.target.checked); setPage(1); }} />
              Chỉ phiếu đã bị trả lại
            </label>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAdvanced}
                disabled={advancedCount === 0}
              >
                <X /> Xoá bộ lọc nâng cao
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Chưa có phiếu nào"
            description="Tạo phiếu đề nghị sửa hồ sơ bệnh án đầu tiên để bắt đầu quy trình ký."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                {canSomeSign ? (
                  <Th className="w-9">
                    <input type="checkbox" aria-label="Chọn tất cả phiếu ký được trên trang" checked={allPageChecked} onChange={togglePage} disabled={signableOnPage.length === 0} className="align-middle" />
                  </Th>
                ) : null}
                <Th>Số phiếu</Th>
                <Th>Người bệnh</Th>
                <Th>Khoa / người đề nghị</Th>
                <Th>Trạng thái</Th>
                <Th>Đang chờ</Th>
                <Th className="text-right">Số tiền</Th>
                <Th className="text-right">Tuổi phiếu</Th>
                <Th className="sticky right-0 z-[1] bg-[var(--card)] text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,.35)]">Thao tác</Th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <Tr key={row.id} className={cn(selected.has(row.id) && 'bg-[var(--primary)]/5')}>
                  {canSomeSign ? (
                    <Td>
                      <input type="checkbox" aria-label={'Chọn phiếu ' + row.code} checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} disabled={!row.canSign} title={row.canSign ? 'Chọn để ký nhanh' : 'Phiếu này không chờ bạn ký'} className="align-middle disabled:opacity-30" />
                    </Td>
                  ) : null}
                  <Td>
                    <Link href={`/ho-so-benh-an/${row.id}`} className="font-mono text-xs font-semibold text-[var(--primary)] hover:underline">
                      {row.code}
                    </Link>
                    {row.priority && row.priority !== 'NORMAL' ? (
                      <Badge tone={row.priority === 'URGENT' ? 'danger' : row.priority === 'HIGH' ? 'warning' : 'muted'}>
                        {row.priority === 'URGENT' ? 'Khẩn' : row.priority === 'HIGH' ? 'Ưu tiên' : 'Thấp'}
                      </Badge>
                    ) : null}
                    <div className="text-[10px] text-[var(--muted-foreground)]">{formatDate(row.updatedAt)}</div>
                  </Td>
                  <Td>
                    <div className="font-medium">{row.patientName}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {[row.patientBirthYear, row.patientGender].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--muted-foreground)]">
                      {row.maKcb ? `KCB: ${row.maKcb}` : ''} {row.maTheBhyt ? `· BHYT: ${row.maTheBhyt}` : ''}
                    </div>
                  </Td>
                  <Td>
                    <div className="text-sm">{row.departmentName || '—'}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{row.requesterName}</div>
                  </Td>
                  <Td>
                    <StatusBadge status={row.status} label={row.statusLabel} />
                    {row.returnCount > 0 ? (
                      <div className="mt-0.5 text-[10px] text-[var(--warning, #b45309)]">Đã trả lại {row.returnCount} lần</div>
                    ) : null}
                  </Td>
                  <Td className="text-xs">{row.pendingStepName || row.pendingStepKey || '—'}</Td>
                  <Td className="text-right text-sm tabular-nums">
                    {row.amount ? Number(row.amount).toLocaleString('vi-VN') : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <div className={cn('text-xs tabular-nums', row.overdue && 'font-semibold text-[var(--destructive,#b91c1c)]')}>
                      {(row.waitingHours ?? 0) < 48 ? `${row.waitingHours ?? 0}h` : `${Math.floor((row.waitingHours ?? 0) / 24)} ngày`}
                    </div>
                    {row.overdue ? (
                      <Badge tone="danger">Quá hạn</Badge>
                    ) : null}
                  </Td>
                  <Td className="sticky right-0 bg-[var(--card)] text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,.35)]">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/ho-so-benh-an/${row.id}`}
                        className="rounded-lg p-2 text-xs hover:bg-[var(--muted)]"
                        title="Xem chi tiết và ký"
                      >
                        Chi tiết
                      </Link>
                      {can('hsba.request.print') ? (
                        <a
                          href={`/api/hsba/requests/${row.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            void openFileUrl(`/api/hsba/requests/${row.id}/pdf`);
                          }}
                          className="rounded-lg p-2 hover:bg-[var(--muted)]"
                          title="In phiếu PDF"
                        >
                          <FileDown className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}

        {data && data.total > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-[var(--muted-foreground)]">
            <div>
              {data.total} phiếu · Trang {data.page}/{Math.max(1, data.totalPages)}
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft /> Trước
              </Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Sau <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function HsbaListPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <RequestsContent />
    </Suspense>
  );
}
