'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight, CalendarClock, CheckCircle2, ChevronDown, CircleDollarSign, ClipboardList, Copy, FilePlus2, History, Layers, Pencil, Printer, ShieldCheck, Trash2, Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { AssetFormDialog } from '@/components/assets/asset-form';
import { AssetStatus, AssetSubnav, DueBadge, Field, Pill, TxStatus } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/api';
import { type AssetRow, money, moneyShort, pct, useAssetMeta } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

interface Detail extends AssetRow {
  raw: Record<string, unknown> & {
    specifications: string; invoiceNo: string; contractNo: string; registrationNo: string; note: string; openingAccumulated: number; openingDate: string | null;
    lastCalibrationDate: string | null; lastMaintenanceDate: string | null; calibrationIntervalMonths: number; maintenanceIntervalMonths: number;
    depreciationStartDate: string | null; residualValue: number; kind: string; createdAt: string;
  };
  methodLabel: string;
  statusLabel: string;
  conditionLabel: string;
  depreciationRemaining: number;
  parent: AssetRow | null;
  children: AssetRow[];
  events: { id: number; eventType: string; title: string; detail: Record<string, unknown>; userName: string; createdAt: string; transactionId: number | null }[];
  transactions: { id: number; code: string; type: string; typeLabel: string; txDate: string; status: string; reason: string; amount: number; itemNote: string }[];
  depreciation: { id: number; period: string; amount: number; accumulatedAfter: number; bookValueAfter: number; runId: number }[];
  schedule: { period: string; amount: number; accumulated: number; bookValue: number }[];
  locked: boolean;
}

const EVENT_STYLE: Record<string, { color: string; icon: typeof History }> = {
  CREATED: { color: '#0d9488', icon: FilePlus2 },
  UPDATED: { color: '#2563eb', icon: Pencil },
  LABEL_PRINTED: { color: '#64748b', icon: Printer },
  CAP_PHAT: { color: '#16a34a', icon: ArrowLeftRight },
  DIEU_CHUYEN: { color: '#0891b2', icon: ArrowLeftRight },
  THU_HOI: { color: '#64748b', icon: ArrowLeftRight },
  BAO_HONG: { color: '#dc2626', icon: Wrench },
  SUA_CHUA: { color: '#d97706', icon: Wrench },
  HOAN_THANH_SUA: { color: '#16a34a', icon: CheckCircle2 },
  BAO_DUONG: { color: '#0891b2', icon: Wrench },
  KIEM_DINH: { color: '#7c3aed', icon: ShieldCheck },
  DANH_GIA_LAI: { color: '#ca8a04', icon: CircleDollarSign },
  DE_NGHI_THANH_LY: { color: '#9333ea', icon: ClipboardList },
  THANH_LY: { color: '#334155', icon: Trash2 },
  BAO_MAT: { color: '#991b1b', icon: Trash2 },
};

function Section({ title, icon: Icon, children, className }: { title: string; icon?: typeof History; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-700">
        {Icon ? <Icon className="size-3.5" /> : null}
        {title}
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const meta = useAssetMeta();
  const [tab, setTab] = useState('info');
  const [edit, setEdit] = useState<null | 'edit' | 'clone'>(null);
  const [del, setDel] = useState(false);
  const [txMenu, setTxMenu] = useState(false);
  const [qr, setQr] = useState('');

  const { data: a, isLoading, error } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<Detail>(`/assets/${id}`),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!a) return;
    QRCode.toDataURL(`${window.location.origin}/ts/${encodeURIComponent(a.code)}`, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [a]);

  const remove = useMutation({
    mutationFn: () => apiFetch(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Đã xoá tài sản');
      qc.invalidateQueries({ queryKey: ['assets'] });
      router.push('/tai-san/danh-sach');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <Skeleton className="h-[70vh]" />;
  if (error || !a) {
    return (
      <div className="space-y-4">
        <AssetSubnav />
        <EmptyState title="Không mở được hồ sơ tài sản" description={(error as Error)?.message ?? 'Không tìm thấy'} />
      </div>
    );
  }

  const cost = Number(a.originalCost);
  const acc = Number(a.accumulatedDepreciation);
  const wear = pct(acc, cost);
  const r = a.raw;
  const txTypes = Object.entries(meta.data?.txTypes ?? {}).filter(([k, t]) => k !== 'GHI_TANG' && t.allowed.includes(a.status));

  const chart: { period: string; bookValue?: number; forecast?: number; amount: number }[] = [
    ...[...a.depreciation].reverse().map((d) => ({ period: d.period, bookValue: Number(d.bookValueAfter), amount: Number(d.amount) })),
    ...a.schedule.map((s) => ({ period: s.period, forecast: Number(s.bookValue), amount: Number(s.amount) })),
  ];
  // nối đường dự báo (nét đứt) với điểm đã chốt cuối cùng
  const lastActual = a.depreciation.length ? chart[a.depreciation.length - 1] : undefined;
  if (lastActual && a.schedule.length) lastActual.forecast = lastActual.bookValue;

  const editInitial = { ...r, tags: a.tags };
  const cloneInitial = { ...r, id: undefined, code: '', serialNumber: '', barcode: '', tags: a.tags, openingAccumulated: 0, status: '' };

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/tai-san">Quản lý tài sản</Link> / <Link href="/tai-san/danh-sach">Danh sách</Link> / {a.code}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.name}
            <AssetStatus status={a.status} />
          </span>
        }
        description={
          <span className="font-mono text-xs">
            {a.code}
            {a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}
            {a.model ? ` · ${a.model}` : ''}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can('asset.transaction.create') && txTypes.length ? (
              <div className="relative">
                <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setTxMenu((v) => !v)}>
                  <ArrowLeftRight className="size-4" /> Nghiệp vụ <ChevronDown className="size-3.5" />
                </Button>
                {txMenu ? (
                  <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border bg-[var(--card)] p-1 shadow-xl" onMouseLeave={() => setTxMenu(false)}>
                    {txTypes.map(([k, t]) => (
                      <Link key={k} href={`/tai-san/nghiep-vu/tao-moi?type=${k}&ids=${a.id}`} className="block rounded-lg px-3 py-1.5 text-sm hover:bg-teal-50" title={t.description}>
                        {t.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {can('asset.label.print') ? (
              <Button variant="outline" onClick={() => router.push(`/tai-san/in-tem?ids=${a.id}`)}>
                <Printer className="size-4" /> In tem
              </Button>
            ) : null}
            {can('asset.update') ? (
              <Button variant="outline" onClick={() => setEdit('edit')}>
                <Pencil className="size-4" /> Sửa
              </Button>
            ) : null}
            {can('asset.create') ? (
              <Button variant="ghost" onClick={() => setEdit('clone')} title="Nhân bản hồ sơ (tạo tài sản tương tự)">
                <Copy className="size-4" />
              </Button>
            ) : null}
            {can('asset.delete') ? (
              <Button variant="ghost" className="text-red-600" onClick={() => setDel(true)} title="Xoá">
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
        }
      />
      <AssetSubnav />

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {/* Thẻ giá trị */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Nguyên giá</div>
              <div className="text-xl font-bold tabular-nums">{money(cost)} đ</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">{a.fundingSourceName ?? 'Chưa rõ nguồn vốn'}</div>
            </Card>
            <Card className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Hao mòn luỹ kế</div>
              <div className="text-xl font-bold tabular-nums text-amber-700">{money(acc)} đ</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, wear)}%` }} />
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                {wear}% · kỳ gần nhất {a.lastDepreciationPeriod || 'chưa có'}
              </div>
            </Card>
            <Card className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Giá trị còn lại</div>
              <div className="text-xl font-bold tabular-nums text-emerald-700">{money(a.bookValue)} đ</div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                {a.methodLabel}
                {a.annualRate ? ` · ${a.annualRate}%/năm` : ''}
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                {
                  key: 'info',
                  label: 'Hồ sơ',
                  content: (
                    <div className="space-y-6 pt-2">
                      {a.locked ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Tài sản đã phát sinh nghiệp vụ/khấu hao — nguyên giá, khoa/phòng, người giữ, trạng thái chỉ thay đổi qua chứng từ để đảm bảo sổ sách.
                        </div>
                      ) : null}
                      <Section title="Định danh" icon={Layers}>
                        <Field label="Mã tài sản"><span className="font-mono">{a.code}</span></Field>
                        <Field label="Mã vạch riêng"><span className="font-mono">{a.barcode}</span></Field>
                        <Field label="Loại tài sản">{a.categoryName}</Field>
                        <Field label="Phân loại">{meta.data?.kinds?.[r.kind] ?? r.kind}</Field>
                        <Field label="Model">{a.model}</Field>
                        <Field label="Số serial"><span className="font-mono">{a.serialNumber}</span></Field>
                        <Field label="Hãng sản xuất">{a.manufacturerName}</Field>
                        <Field label="Nước sản xuất">{a.countryOfOrigin}</Field>
                        <Field label="Năm sản xuất">{a.yearOfManufacture}</Field>
                        <Field label="Đơn vị tính">{a.unit}</Field>
                        <Field label="Tình trạng">{a.conditionLabel}</Field>
                        <Field label="Nhãn">
                          {a.tags?.length ? (
                            <span className="flex flex-wrap gap-1">
                              {a.tags.map((t) => (
                                <Pill key={t} color="#64748b">{t}</Pill>
                              ))}
                            </span>
                          ) : null}
                        </Field>
                        {r.specifications ? <Field label="Thông số kỹ thuật" className="sm:col-span-2 lg:col-span-3"><span className="whitespace-pre-wrap">{r.specifications}</span></Field> : null}
                      </Section>
                      <Section title="Sử dụng" icon={ArrowLeftRight}>
                        <Field label="Khoa/phòng">{a.departmentName ?? 'Kho'}</Field>
                        <Field label="Vị trí">{a.locationName}</Field>
                        <Field label="Người giữ">{a.custodianName}</Field>
                        <Field label="Ngày ghi tăng">{a.acquisitionDate ? formatDate(a.acquisitionDate) : null}</Field>
                        <Field label="Ngày đưa vào sử dụng">{a.inUseDate ? formatDate(a.inUseDate) : null}</Field>
                        <Field label="Thuộc tài sản">{a.parent ? <Link className="text-teal-700 hover:underline" href={`/tai-san/${a.parent.id}`}>{a.parent.code} — {a.parent.name}</Link> : null}</Field>
                      </Section>
                      <Section title="Nguồn gốc & giá trị" icon={CircleDollarSign}>
                        <Field label="Nhà cung cấp">{a.supplierName}</Field>
                        <Field label="Số hợp đồng">{r.contractNo}</Field>
                        <Field label="Số hoá đơn">{r.invoiceNo}</Field>
                        <Field label="Bảo hành đến">{a.warrantyUntil ? <DueBadge date={a.warrantyUntil} /> : null}</Field>
                        <Field label="Hao mòn đầu kỳ">{Number(r.openingAccumulated) ? `${money(r.openingAccumulated)} đ (chốt ${r.openingDate ? formatDate(r.openingDate) : '—'})` : null}</Field>
                        <Field label="Thời gian sử dụng">{a.usefulLifeMonths ? `${a.usefulLifeMonths} tháng (${Math.round((a.usefulLifeMonths / 12) * 10) / 10} năm)` : null}</Field>
                        <Field label="Bắt đầu tính hao mòn">{r.depreciationStartDate ? formatDate(r.depreciationStartDate) : a.inUseDate ? `${formatDate(a.inUseDate)} (ngày sử dụng)` : null}</Field>
                        <Field label="Giá trị thu hồi">{Number(r.residualValue) ? `${money(r.residualValue)} đ` : null}</Field>
                      </Section>
                      <Section title="Kỹ thuật (TBYT)" icon={ShieldCheck}>
                        <Field label="Phân loại mức độ rủi ro">{a.riskClass ? `Loại ${a.riskClass}` : null}</Field>
                        <Field label="Số lưu hành">{r.registrationNo}</Field>
                        <Field label="Phải kiểm định">{a.requiresCalibration ? `Có · chu kỳ ${r.calibrationIntervalMonths || '?'} tháng` : 'Không'}</Field>
                        <Field label="Kiểm định gần nhất">{r.lastCalibrationDate ? formatDate(r.lastCalibrationDate) : null}</Field>
                        <Field label="Bảo dưỡng gần nhất">{r.lastMaintenanceDate ? formatDate(r.lastMaintenanceDate) : null}</Field>
                        <Field label="Chu kỳ bảo dưỡng">{r.maintenanceIntervalMonths ? `${r.maintenanceIntervalMonths} tháng` : null}</Field>
                      </Section>
                      {r.note ? <Section title="Ghi chú"><Field label="" className="sm:col-span-3">{r.note}</Field></Section> : null}
                    </div>
                  ),
                },
                {
                  key: 'timeline',
                  label: `Dòng thời gian (${a.events.length})`,
                  content: (
                    <ol className="relative ml-3 space-y-4 border-l-2 border-slate-200 pt-3">
                      {a.events.map((e) => {
                        const st = EVENT_STYLE[e.eventType] ?? { color: '#64748b', icon: History };
                        const changes = (e.detail?.changes ?? null) as Record<string, { from: unknown; to: unknown }> | null;
                        return (
                          <li key={e.id} className="relative pl-6">
                            <span className="absolute -left-[13px] top-0 grid size-6 place-items-center rounded-full text-white ring-4 ring-[var(--card)]" style={{ background: st.color }}>
                              <st.icon className="size-3" />
                            </span>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-sm font-medium">{e.title}</span>
                              {e.transactionId ? (
                                <Link href={`/tai-san/nghiep-vu/${e.transactionId}`} className="text-xs text-teal-700 hover:underline">
                                  xem chứng từ
                                </Link>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-[var(--muted-foreground)]">
                              {formatDateTime(e.createdAt)} · {e.userName}
                            </div>
                            {changes ? (
                              <div className="mt-1 space-y-0.5 rounded-lg bg-[var(--muted)]/60 px-2 py-1 text-[11px]">
                                {Object.entries(changes).slice(0, 8).map(([k, c]) => (
                                  <div key={k}>
                                    <span className="text-[var(--muted-foreground)]">{k}:</span> <span className="line-through opacity-60">{String(c.from ?? '—')}</span> → <b>{String(c.to ?? '—')}</b>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {e.detail?.reason ? <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">Lý do: {String(e.detail.reason)}</div> : null}
                          </li>
                        );
                      })}
                    </ol>
                  ),
                },
                {
                  key: 'tx',
                  label: `Chứng từ (${a.transactions.length})`,
                  content: a.transactions.length ? (
                    <div className="thin-scroll overflow-x-auto pt-2">
                      <table className="w-full text-sm">
                        <thead className="bg-[var(--muted)] text-left text-xs">
                          <tr>
                            <th className="p-2">Số chứng từ</th>
                            <th className="p-2">Loại</th>
                            <th className="p-2">Ngày</th>
                            <th className="p-2">Nội dung</th>
                            <th className="p-2 text-right">Số tiền</th>
                            <th className="p-2">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.transactions.map((t) => (
                            <tr key={t.id} className="border-t hover:bg-[var(--muted)]/40">
                              <td className="p-2">
                                <Link href={`/tai-san/nghiep-vu/${t.id}`} className="font-mono text-xs font-semibold text-teal-700 hover:underline">
                                  {t.code}
                                </Link>
                              </td>
                              <td className="p-2 text-xs">{t.typeLabel}</td>
                              <td className="p-2 text-xs">{formatDate(t.txDate)}</td>
                              <td className="p-2 text-xs">{t.reason || t.itemNote}</td>
                              <td className="p-2 text-right tabular-nums">{Number(t.amount) ? money(t.amount) : ''}</td>
                              <td className="p-2">
                                <TxStatus status={t.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState title="Chưa có chứng từ" description="Cấp phát, điều chuyển, sửa chữa… sẽ hiện tại đây." />
                  ),
                },
                {
                  key: 'depr',
                  label: 'Khấu hao / hao mòn',
                  content: (
                    <div className="space-y-4 pt-2">
                      {chart.length ? (
                        <div className="h-64">
                          <ResponsiveContainer>
                            <ComposedChart data={chart} margin={{ left: 8, right: 8, top: 8 }}>
                              <defs>
                                <linearGradient id="bv" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                                  <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                              <YAxis tickFormatter={(v) => moneyShort(v)} tick={{ fontSize: 11 }} width={70} />
                              <Tooltip formatter={(v, n) => [`${money(v)} đ`, n === 'bookValue' ? 'Còn lại (đã chốt)' : n === 'forecast' ? 'Còn lại (dự kiến)' : 'Hao mòn kỳ']} />
                              <Area type="monotone" dataKey="bookValue" stroke="#0d9488" fill="url(#bv)" strokeWidth={2} connectNulls />
                              <Line type="monotone" dataKey="forecast" stroke="#0d9488" strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2 }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <EmptyState title="Chưa có số liệu khấu hao" description={a.depreciationMethod === 'NONE' ? 'Tài sản không tính khấu hao.' : 'Chưa chốt kỳ nào và chưa đủ thông tin để dự báo.'} />
                      )}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase text-teal-700">Đã chốt</div>
                          <table className="w-full text-sm">
                            <thead className="bg-[var(--muted)] text-left text-xs">
                              <tr>
                                <th className="p-2">Kỳ</th>
                                <th className="p-2 text-right">Hao mòn</th>
                                <th className="p-2 text-right">Luỹ kế</th>
                                <th className="p-2 text-right">Còn lại</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.depreciation.map((d) => (
                                <tr key={d.id} className="border-t">
                                  <td className="p-2 font-mono text-xs">{d.period}</td>
                                  <td className="p-2 text-right tabular-nums">{money(d.amount)}</td>
                                  <td className="p-2 text-right tabular-nums">{money(d.accumulatedAfter)}</td>
                                  <td className="p-2 text-right tabular-nums">{money(d.bookValueAfter)}</td>
                                </tr>
                              ))}
                              {!a.depreciation.length ? (
                                <tr>
                                  <td colSpan={4} className="p-3 text-center text-xs text-[var(--muted-foreground)]">
                                    Chưa có kỳ nào được chốt
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Dự kiến các năm tới</div>
                          <table className="w-full text-sm">
                            <thead className="bg-[var(--muted)] text-left text-xs">
                              <tr>
                                <th className="p-2">Năm</th>
                                <th className="p-2 text-right">Hao mòn</th>
                                <th className="p-2 text-right">Luỹ kế</th>
                                <th className="p-2 text-right">Còn lại</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.schedule.map((d) => (
                                <tr key={d.period} className="border-t text-[var(--muted-foreground)]">
                                  <td className="p-2 font-mono text-xs">{d.period}</td>
                                  <td className="p-2 text-right tabular-nums">{money(d.amount)}</td>
                                  <td className="p-2 text-right tabular-nums">{money(d.accumulated)}</td>
                                  <td className="p-2 text-right tabular-nums">{money(d.bookValue)}</td>
                                </tr>
                              ))}
                              {!a.schedule.length ? (
                                <tr>
                                  <td colSpan={4} className="p-3 text-center text-xs text-[var(--muted-foreground)]">
                                    Không còn kỳ nào cần tính
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'children',
                  label: `Thành phần (${a.children.length})`,
                  content: a.children.length ? (
                    <table className="mt-2 w-full text-sm">
                      <thead className="bg-[var(--muted)] text-left text-xs">
                        <tr>
                          <th className="p-2">Mã</th>
                          <th className="p-2">Tên</th>
                          <th className="p-2">Serial</th>
                          <th className="p-2 text-right">Nguyên giá</th>
                          <th className="p-2">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.children.map((c) => (
                          <tr key={c.id} className="border-t">
                            <td className="p-2">
                              <Link href={`/tai-san/${c.id}`} className="font-mono text-xs text-teal-700 hover:underline">
                                {c.code}
                              </Link>
                            </td>
                            <td className="p-2">{c.name}</td>
                            <td className="p-2 font-mono text-xs">{c.serialNumber}</td>
                            <td className="p-2 text-right tabular-nums">{money(c.originalCost)}</td>
                            <td className="p-2">
                              <AssetStatus status={c.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <EmptyState title="Không có thành phần" description="Tài sản cấu thành (vd: đầu dò của máy siêu âm) chọn 'Thuộc tài sản' khi nhập hồ sơ." />
                  ),
                },
              ]}
            />
          </Card>
        </div>

        {/* Cột phải */}
        <div className="space-y-4">
          <Card className="p-4 text-center">
            {qr ? <img src={qr} alt={`QR ${a.code}`} className="mx-auto size-44 rounded-lg border p-1" /> : <Skeleton className="mx-auto size-44" />}
            <div className="mt-2 font-mono text-sm font-bold tracking-wide">{a.code}</div>
            <div className="text-[11px] text-[var(--muted-foreground)]">Quét bằng điện thoại để mở hồ sơ này</div>
          </Card>
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-700">
              <CalendarClock className="size-3.5" /> Lịch cần theo dõi
            </div>
            {[
              { l: 'Kiểm định / hiệu chuẩn', d: a.nextCalibrationDate, t: 'KIEM_DINH' },
              { l: 'Bảo dưỡng định kỳ', d: a.nextMaintenanceDate, t: 'BAO_DUONG' },
              { l: 'Hết bảo hành', d: a.warrantyUntil, t: '' },
            ].map((x) => (
              <div key={x.l} className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm">{x.l}</div>
                  {!x.d ? <div className="text-[11px] text-[var(--muted-foreground)]">Chưa đặt</div> : null}
                </div>
                <div className="flex items-center gap-1">
                  <DueBadge date={x.d} empty="" />
                  {x.t && can('asset.transaction.create') && txTypes.some(([k]) => k === x.t) ? (
                    <Link href={`/tai-san/nghiep-vu/tao-moi?type=${x.t}&ids=${a.id}`} className="rounded-md px-1.5 py-0.5 text-[11px] text-teal-700 hover:bg-teal-50">
                      Ghi nhận
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </Card>
          <Card className="space-y-1.5 p-4 text-xs text-[var(--muted-foreground)]">
            <div>Tạo lúc: {formatDateTime(r.createdAt)}</div>
            <div>Cập nhật: {formatDateTime(a.updatedAt)}</div>
            {a.lastInventoryAt ? <div>Kiểm kê gần nhất: {formatDateTime(a.lastInventoryAt)}</div> : null}
          </Card>
        </div>
      </div>

      <AssetFormDialog
        open={edit !== null}
        onClose={() => setEdit(null)}
        initial={edit === 'edit' ? editInitial : edit === 'clone' ? cloneInitial : null}
        locked={edit === 'edit' && a.locked}
        onSaved={(res) => {
          const x = res as { id?: number };
          if (edit === 'clone' && x?.id) router.push(`/tai-san/${x.id}`);
        }}
      />
      <ConfirmDialog
        open={del}
        title={`Xoá tài sản ${a.code}?`}
        message="Tài sản bị xoá sẽ không còn trong danh sách và báo cáo. Chỉ xoá được tài sản chưa phát sinh chứng từ đã duyệt / chưa chốt khấu hao."
        confirmText="Xoá"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDel(false)}
      />
    </div>
  );
}
