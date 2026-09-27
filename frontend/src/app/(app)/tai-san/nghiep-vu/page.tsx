'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AssetSubnav, TxStatus } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { money, TX_STATUS, useAssetMeta } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

interface TxRow {
  id: number; code: string; type: string; typeLabel: string; txDate: string; status: string; reason: string; decisionNo: string; amount: number;
  fromDepartmentName: string | null; toDepartmentName: string | null; createdByName: string; approvedByName: string | null; approvedAt: string | null;
  createdAt: string; itemCount: number; preview: string | null;
}
interface Res { items: TxRow[]; total: number; counts: { pending: number; draft: number } }

const STATUS_TABS = [
  { key: '', label: 'Tất cả' },
  { key: 'CHO_DUYET', label: 'Chờ duyệt' },
  { key: 'NHAP', label: 'Nháp' },
  { key: 'DA_DUYET', label: 'Đã duyệt' },
  { key: 'TU_CHOI', label: 'Từ chối' },
  { key: 'DA_HUY', label: 'Đã huỷ' },
];

function TxListContent() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useAuth((s) => s.can);
  const meta = useAssetMeta();
  const [status, setStatus] = useState(params.get('status') ?? (can('asset.transaction.approve') ? 'CHO_DUYET' : ''));
  const [type, setType] = useState(params.get('type') ?? '');
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setKw(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [status, type, kw, from, to, mine]);

  const qs = new URLSearchParams({ page: String(page), pageSize: '30', ...(status && { status }), ...(type && { type }), ...(kw && { q: kw }), ...(from && { dateFrom: from }), ...(to && { dateTo: to }), ...(mine && { mine: 'true' }) }).toString();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['asset-tx', qs],
    queryFn: () => apiFetch<Res>(`/asset-transactions?${qs}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 30));

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>}
        title="Chứng từ nghiệp vụ"
        description="Cấp phát, điều chuyển, thu hồi, sửa chữa, bảo dưỡng, kiểm định, đánh giá lại, thanh lý — quy trình lập → duyệt → tự cập nhật tài sản."
        actions={
          can('asset.transaction.create') ? (
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => router.push('/tai-san/nghiep-vu/tao-moi')}>
              <Plus className="size-4" /> Lập chứng từ
            </Button>
          ) : null
        }
      />
      <AssetSubnav />

      <Card className="space-y-3 p-3">
        <div className="thin-scroll flex gap-1 overflow-x-auto">
          {STATUS_TABS.map((t) => {
            const n = t.key === 'CHO_DUYET' ? data?.counts.pending : t.key === 'NHAP' ? data?.counts.draft : undefined;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                onClick={() => setStatus(t.key)}
                className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs', status === t.key ? 'border-teal-600 bg-teal-600 text-white' : 'bg-[var(--card)] hover:border-teal-400')}
              >
                {TX_STATUS[t.key] ? <span className="size-2 rounded-full" style={{ background: TX_STATUS[t.key].color }} /> : null}
                {t.label}
                {n ? <span className={cn('rounded-full px-1.5 text-[10px] font-bold', status === t.key ? 'bg-white/25' : 'bg-amber-100 text-amber-800')}>{n}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input className="pl-8" placeholder="Số chứng từ, số quyết định, mã/tên tài sản…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-52" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Mọi loại nghiệp vụ</option>
            {Object.entries(meta.data?.txTypes ?? {}).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} title="Từ ngày" />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} title="Đến ngày" />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="accent-teal-600" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Do tôi lập
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="p-2">Số chứng từ</th>
                <th className="p-2">Nghiệp vụ</th>
                <th className="p-2">Ngày</th>
                <th className="p-2">Tài sản</th>
                <th className="p-2">Từ → Đến</th>
                <th className="p-2">Nội dung</th>
                <th className="p-2 text-right">Số tiền</th>
                <th className="p-2">Người lập / duyệt</th>
                <th className="p-2">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={9} className="p-2">
                        <Skeleton className="h-6" />
                      </td>
                    </tr>
                  ))
                : (data?.items ?? []).map((t) => (
                    <tr key={t.id} onClick={() => router.push(`/tai-san/nghiep-vu/${t.id}`)} className="cursor-pointer border-t hover:bg-teal-50/40">
                      <td className="whitespace-nowrap p-2 font-mono text-xs font-semibold text-teal-700">{t.code}</td>
                      <td className="p-2 text-xs font-medium">{t.typeLabel}</td>
                      <td className="whitespace-nowrap p-2 text-xs">{formatDate(t.txDate)}</td>
                      <td className="p-2 text-xs">
                        <b>{t.itemCount}</b> <span className="text-[var(--muted-foreground)]">· {t.preview}{t.itemCount > 3 ? '…' : ''}</span>
                      </td>
                      <td className="p-2 text-xs">
                        {t.fromDepartmentName || t.toDepartmentName ? `${t.fromDepartmentName ?? 'Kho'} → ${t.toDepartmentName ?? '—'}` : '—'}
                      </td>
                      <td className="max-w-[260px] truncate p-2 text-xs" title={t.reason}>
                        {t.decisionNo ? <span className="mr-1 text-[var(--muted-foreground)]">[{t.decisionNo}]</span> : null}
                        {t.reason}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right tabular-nums">{Number(t.amount) ? money(t.amount) : ''}</td>
                      <td className="p-2 text-xs">
                        <div>{t.createdByName}</div>
                        {t.approvedByName ? <div className="text-[var(--muted-foreground)]">✓ {t.approvedByName} · {t.approvedAt ? formatDateTime(t.approvedAt) : ''}</div> : null}
                      </td>
                      <td className="p-2">
                        <TxStatus status={t.status} />
                      </td>
                    </tr>
                  ))}
              {!isLoading && !data?.items.length ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-sm text-[var(--muted-foreground)]">
                    Không có chứng từ phù hợp.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
          <span className="text-[var(--muted-foreground)]">{isFetching ? 'Đang tải…' : `${data?.total ?? 0} chứng từ`}</span>
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
    </div>
  );
}

export default function TxListPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <TxListContent />
    </Suspense>
  );
}
