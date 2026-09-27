'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, CalendarClock, ClipboardCheck, Coins, Plus, ScanLine, ShieldAlert, TrendingDown, Wrench } from 'lucide-react';
import Link from 'next/link';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AssetSubnav, Kpi, Pill } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Card, Skeleton } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { daysUntil, GROUP_COLORS, money, moneyShort, pct, useAssetMeta } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

interface Bucket { key: string; label: string; count: number; cost: number; bookValue: number; color?: string }
interface Dash {
  totals: Record<string, number>;
  byStatus: Bucket[];
  byGroup: Bucket[];
  byDepartment: Bucket[];
  byCategory: Bucket[];
  byFunding: Bucket[];
  byYear: { year: number; count: number; cost: number }[];
  byAge: { bucket: string; count: number; cost: number }[];
  upcoming: { id: number; code: string; name: string; kind: string; due: string; departmentName: string | null }[];
  pendingTx: { type: string; label: string; count: number }[];
  pendingTotal: number;
  recent: { id: number; assetId: number; code: string; name: string; eventType: string; title: string; userName: string; createdAt: string }[];
  generatedAt: string;
}

const DUE_LABEL: Record<string, { label: string; color: string }> = {
  KIEM_DINH: { label: 'Kiểm định', color: '#7c3aed' },
  BAO_DUONG: { label: 'Bảo dưỡng', color: '#0891b2' },
  BAO_HANH: { label: 'Hết bảo hành', color: '#ea580c' },
};

function ChartCard({ title, subtitle, children, className, action }: { title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="text-[11px] text-[var(--muted-foreground)]">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </Card>
  );
}

const tooltipMoney = (v: unknown, name: unknown) => [String(name).includes('Số') ? String(v) : `${money(v)} đ`, String(name)];

export default function AssetDashboardPage() {
  const can = useAuth((s) => s.can);
  const meta = useAssetMeta();
  const { data, isLoading, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['asset-dashboard'],
    queryFn: () => apiFetch<Dash>('/assets/dashboard'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Quản lý tài sản" description="Đang tải số liệu…" />
        <AssetSubnav />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }
  const t = data.totals;
  const wearPct = pct(t.accumulated, t.cost);
  const groupLabel = (k: string) => meta.data?.groups[k] ?? k;
  const calAlerts = t.calOverdue + t.calDue30;
  const mtAlerts = t.mtOverdue + t.mtDue30;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quản lý tài sản"
        description={
          <span className="inline-flex items-center gap-2">
            <span className={cn('size-2 rounded-full', isFetching ? 'animate-pulse bg-amber-500' : 'bg-emerald-500')} />
            Số liệu trực tiếp · cập nhật {formatDateTime(new Date(dataUpdatedAt).toISOString())} · tự làm mới 30 giây
          </span>
        }
        actions={
          <>
            {can('asset.view') ? (
              <Link href="/tai-san/tra-cuu" className="inline-flex h-9.5 items-center gap-2 rounded-lg border bg-[var(--card)] px-4 text-sm font-medium hover:bg-[var(--accent)]">
                <ScanLine className="size-4" /> Quét mã
              </Link>
            ) : null}
            {can('asset.create') ? (
              <Link href="/tai-san/danh-sach?new=1" className="inline-flex h-9.5 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-teal-700">
                <Plus className="size-4" /> Thêm tài sản
              </Link>
            ) : null}
          </>
        }
      />
      <AssetSubnav />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Tài sản đang theo dõi" value={t.activeCount.toLocaleString('vi-VN')} hint={`${t.count.toLocaleString('vi-VN')} hồ sơ (gồm đã thanh lý)`} icon={<Boxes className="size-4" />} color="#0d9488" href="/tai-san/danh-sach?status=ACTIVE" />
        <Kpi label="Tổng nguyên giá" value={moneyShort(t.cost)} hint={`${money(t.cost)} đ`} icon={<Coins className="size-4" />} color="#2563eb" />
        <Kpi label="Giá trị còn lại" value={moneyShort(t.bookValue)} hint={`Đã hao mòn ${wearPct}% · ${t.fullyDepreciated} tài sản hết khấu hao`} progress={100 - wearPct} icon={<TrendingDown className="size-4" />} color="#7c3aed" href="/tai-san/khau-hao" />
        <Kpi label="Chứng từ chờ duyệt" value={data.pendingTotal} hint={data.pendingTx.map((p) => `${p.label}: ${p.count}`).join(' · ') || 'Không có chứng từ tồn'} icon={<ClipboardCheck className="size-4" />} color="#d97706" href="/tai-san/nghiep-vu?status=CHO_DUYET" />
        <Kpi label="Kiểm định / hiệu chuẩn" value={calAlerts} hint={<><b className="text-red-600">{t.calOverdue} quá hạn</b> · {t.calDue30} đến hạn trong 30 ngày</>} icon={<ShieldAlert className="size-4" />} color="#dc2626" href="/tai-san/danh-sach?due=calibration" />
        <Kpi label="Bảo dưỡng định kỳ" value={mtAlerts} hint={<><b className="text-red-600">{t.mtOverdue} quá hạn</b> · {t.mtDue30} đến hạn trong 30 ngày</>} icon={<CalendarClock className="size-4" />} color="#0891b2" href="/tai-san/danh-sach?due=maintenance" />
        <Kpi label="Hỏng / đang sửa" value={`${t.broken} / ${t.repairing}`} hint="Cần xử lý: sửa chữa, điều chuyển hoặc thanh lý" icon={<Wrench className="size-4" />} color="#ea580c" href="/tai-san/danh-sach?status=HONG,DANG_SUA_CHUA" />
        <Kpi label="Chưa kiểm kê > 12 tháng" value={t.noInventory12m} hint={`${t.warrantyDue30} tài sản hết bảo hành trong 30 ngày`} icon={<AlertTriangle className="size-4" />} color="#64748b" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Cơ cấu theo trạng thái" subtitle="Số lượng tài sản">
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.byStatus} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="none">
                  {data.byStatus.map((s) => (
                    <Cell key={s.key} fill={s.color ?? '#64748b'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} tài sản`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Giá trị theo khoa/phòng" subtitle="Nguyên giá & giá trị còn lại (top 10)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.byDepartment.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={moneyShort} fontSize={11} />
                <YAxis type="category" dataKey="label" width={150} fontSize={11} tickLine={false} />
                <Tooltip formatter={tooltipMoney} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="cost" name="Nguyên giá" fill="#99f6e4" radius={[0, 4, 4, 0]} />
                <Bar dataKey="bookValue" name="Còn lại" fill="#0d9488" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Mua sắm 10 năm gần đây" subtitle="Nguyên giá ghi tăng & số lượng theo năm" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={data.byYear} margin={{ right: 8 }}>
                <defs>
                  <linearGradient id="gYear" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" fontSize={11} />
                <YAxis yAxisId="l" tickFormatter={moneyShort} fontSize={11} />
                <YAxis yAxisId="r" orientation="right" fontSize={11} allowDecimals={false} />
                <Tooltip formatter={tooltipMoney} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="l" type="monotone" dataKey="cost" name="Nguyên giá" stroke="#2563eb" fill="url(#gYear)" strokeWidth={2} />
                <Line yAxisId="r" type="monotone" dataKey="count" name="Số tài sản" stroke="#ea580c" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Tuổi thiết bị" subtitle="Tính từ ngày đưa vào sử dụng">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.byAge}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v, n) => [n === 'Số tài sản' ? String(v) : `${money(v)} đ`, n]} />
                <Bar dataKey="count" name="Số tài sản" radius={[6, 6, 0, 0]}>
                  {data.byAge.map((_, i) => (
                    <Cell key={i} fill={['#16a34a', '#0d9488', '#d97706', '#dc2626'][i] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Theo loại tài sản" subtitle="Nhóm cấp 1">
          <div className="space-y-2.5">
            {data.byCategory.map((c, i) => {
              const max = Math.max(...data.byCategory.map((x) => x.cost), 1);
              return (
                <div key={c.key}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{c.label}</span>
                    <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
                      {c.count} · {moneyShort(c.cost)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div className="h-full rounded-full" style={{ width: `${(c.cost / max) * 100}%`, backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                  </div>
                </div>
              );
            })}
            {!data.byCategory.length ? <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">Chưa có tài sản</div> : null}
          </div>
        </ChartCard>
        <ChartCard title="Nguồn vốn hình thành" subtitle="Theo nguyên giá">
          <div className="h-60">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.byFunding} dataKey="cost" nameKey="label" outerRadius={85} innerRadius={40} stroke="none">
                  {data.byFunding.map((_, i) => (
                    <Cell key={i} fill={GROUP_COLORS[(i + 1) % GROUP_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${money(v)} đ`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Theo nhóm quản lý" subtitle="Số lượng · giá trị còn lại">
          <div className="divide-y">
            {data.byGroup.map((g, i) => (
              <div key={g.key} className="flex items-center gap-3 py-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                <span className="flex-1 truncate">{groupLabel(g.key)}</span>
                <span className="tabular-nums text-[var(--muted-foreground)]">{g.count}</span>
                <span className="w-20 text-right font-medium tabular-nums">{moneyShort(g.bookValue)}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Lịch đến hạn 60 ngày" subtitle="Kiểm định · bảo dưỡng · hết bảo hành">
          <div className="thin-scroll max-h-80 divide-y overflow-auto">
            {data.upcoming.map((u, i) => {
              const d = daysUntil(u.due) ?? 0;
              const k = DUE_LABEL[u.kind];
              return (
                <Link key={`${u.id}-${u.kind}-${i}`} href={`/tai-san/${u.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-[var(--muted)]/50">
                  <div className={cn('grid w-14 shrink-0 place-items-center rounded-lg py-1 text-center leading-tight', d < 0 ? 'bg-red-50 text-red-700' : d <= 14 ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600')}>
                    <span className="text-base font-bold tabular-nums">{Math.abs(d)}</span>
                    <span className="text-[9px] font-medium">{d < 0 ? 'ngày trễ' : 'ngày'}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{u.name}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      <span className="font-mono">{u.code}</span> · {u.departmentName ?? 'Kho'} · {formatDate(u.due)}
                    </div>
                  </div>
                  <Pill color={k?.color ?? '#64748b'}>{k?.label ?? u.kind}</Pill>
                </Link>
              );
            })}
            {!data.upcoming.length ? <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">Không có hạn nào trong 60 ngày tới 🎉</div> : null}
          </div>
        </ChartCard>
        <ChartCard title="Hoạt động gần đây" subtitle="Dòng thời gian toàn phân hệ">
          <div className="thin-scroll max-h-80 overflow-auto">
            <ol className="relative ml-2 border-l pl-4">
              {data.recent.map((e) => (
                <li key={e.id} className="mb-3">
                  <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-[var(--card)] bg-teal-500" />
                  <Link href={`/tai-san/${e.assetId}`} className="text-sm hover:underline">
                    <span className="font-medium">{e.title}</span>
                  </Link>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    <span className="font-mono">{e.code}</span> {e.name} · {e.userName} · {formatDateTime(e.createdAt)}
                  </div>
                </li>
              ))}
            </ol>
            {!data.recent.length ? <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">Chưa có hoạt động</div> : null}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
