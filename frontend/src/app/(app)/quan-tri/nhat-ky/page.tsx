'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Filter, History, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AdvancedFilter } from '@/components/shared/advanced-filter';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { Paginated } from '@/types/api';

interface AuditRow {
  id: number;
  userId: number | null;
  username: string;
  fullName: string;
  action: string;
  module: string;
  entity: string;
  entityId: string;
  description: string;
  ip: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  createdAt: string;
}

interface AuditStats {
  days: number;
  total: number;
  byModule: { module: string; total: number }[];
  byAction: { action: string; total: number }[];
}

const MODULES = [
  'AUTH',
  'ADMIN',
  'SYSTEM',
  'HSBA',
  'REPORT',
  'ASSET',
  'PRINT',
  'UTILITY',
  'FILE',
  'DATA',
];

const ACTIONS = ['LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'SIGN', 'RETURN', 'CANCEL', 'EXPORT', 'IMPORT', 'RUN', 'VIEW'];

const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  SIGN: 'success',
  RETURN: 'warning',
  CANCEL: 'danger',
  LOGIN: 'info',
  LOGOUT: 'muted',
  EXPORT: 'info',
  IMPORT: 'warning',
  RUN: 'muted',
  VIEW: 'muted',
};

/** Nhật ký kiểm toán: tra cứu mọi thao tác, phục vụ truy vết và thanh tra. */
export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** Bộ lọc sâu theo trường (lấy cấu hình từ /meta/filters/audit) */
  const [deepFilters, setDeepFilters] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', '25');
    if (search) p.set('q', search);
    const filters: string[] = [];
    if (module) filters.push(`module:eq:${module}`);
    if (action) filters.push(`action:eq:${action}`);
    if (deepFilters) filters.push(deepFilters);
    if (filters.length) p.set('filters', filters.join(','));
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    return p.toString();
  }, [page, search, module, action, dateFrom, dateTo, deepFilters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit', params],
    queryFn: () => apiFetch<Paginated<AuditRow>>(`/audit?${params}`),
  });

  const { data: stats } = useQuery({
    queryKey: ['audit-stats'],
    queryFn: () => apiFetch<AuditStats>('/audit/stats?days=7'),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nhật ký kiểm toán"
        description="Ghi nhận đầy đủ ai làm gì, khi nào, từ địa chỉ nào — không thể sửa hay xoá từ giao diện"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tổng số bản ghi" value={stats?.total ?? 0} icon={<History className="size-4" />} tone="primary" />
        <StatCard label="Trong 7 ngày" value={stats?.byModule.reduce((s, m) => s + m.total, 0) ?? 0} hint="Mọi phân hệ" />
        <StatCard
          label="Phân hệ nhiều nhất"
          value={stats?.byModule[0]?.module ?? '—'}
          hint={stats?.byModule[0] ? `${stats.byModule[0].total} thao tác` : undefined}
          tone="warning"
        />
        <StatCard
          label="Thao tác nhiều nhất"
          value={stats?.byAction[0]?.action ?? '—'}
          hint={stats?.byAction[0] ? `${stats.byAction[0].total} lần` : undefined}
          tone="success"
        />
      </div>

      <Card>
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
              placeholder="Tìm theo mô tả, người dùng, đối tượng…"
              className="h-8.5 w-72 pl-8 text-sm"
            />
          </form>

          <Select
            value={module}
            onChange={(e) => {
              setModule(e.target.value);
              setPage(1);
            }}
            className="h-8.5 w-36 text-sm"
          >
            <option value="">Mọi phân hệ</option>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>

          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className="h-8.5 w-32 text-sm"
          >
            <option value="">Mọi thao tác</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
            <Filter className="size-3.5" />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8.5 w-36 text-sm" />
            <span>→</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8.5 w-36 text-sm" />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKeyword('');
              setSearch('');
              setModule('');
              setAction('');
              setDateFrom('');
              setDateTo('');
              setDeepFilters('');
              setPage(1);
            }}
          >
            Xoá lọc
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {isFetching ? <span className="text-[11px] text-[var(--muted-foreground)]">Đang tải…</span> : null}
            {data ? <Badge tone="muted">{data.total} bản ghi</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const p = new URLSearchParams(params);
                p.set('pageSize', '2000');
                window.open(`/api/audit?${p.toString()}`, '_blank');
              }}
              title="Mở dữ liệu thô ở tab mới"
            >
              <Download />
            </Button>
          </div>

          {/* Lọc sâu theo từng trường: trường lấy từ /meta/filters/audit, có lưu bộ lọc */}
          <div className="w-full">
            <AdvancedFilter
              resource="audit"
              value={deepFilters}
              onChange={(next) => {
                setDeepFilters(next);
                setPage(1);
              }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Không có bản ghi phù hợp" description="Thử mở rộng khoảng ngày hoặc bỏ bớt điều kiện lọc." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Thời điểm</Th>
                <Th>Người dùng</Th>
                <Th>Thao tác</Th>
                <Th>Đối tượng</Th>
                <Th>Mô tả</Th>
                <Th>Nguồn</Th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(row.createdAt)}</Td>
                  <Td>
                    <div className="text-sm">{row.fullName || row.username || 'Hệ thống'}</div>
                    <div className="font-mono text-[10px] text-[var(--muted-foreground)]">{row.username}</div>
                  </Td>
                  <Td>
                    <Badge tone={ACTION_TONE[row.action] ?? 'muted'}>{row.action}</Badge>
                    <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{row.module}</div>
                  </Td>
                  <Td className="text-xs">
                    {row.entity ? (
                      <>
                        <div className="font-mono">{row.entity}</div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">#{row.entityId || '—'}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="max-w-[320px] text-sm">{row.description || '—'}</Td>
                  <Td className="whitespace-nowrap text-[11px] text-[var(--muted-foreground)]">
                    <div>{row.ip || '—'}</div>
                    <div className="tabular-nums">{row.durationMs ? `${row.durationMs}ms` : ''}</div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}

        {data && data.total > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-[var(--muted-foreground)]">
            <div>
              Trang {data.page}/{Math.max(1, data.totalPages)} · {data.total} bản ghi
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
