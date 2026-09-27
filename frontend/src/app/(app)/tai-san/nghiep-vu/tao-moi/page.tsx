'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, ScanLine, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AssetPicker, AssetStatus, AssetSubnav } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { ASSET_CONDITION, ASSET_STATUS, type AssetRow, money, treeLabel, useAssetCatalog, useAssetMeta, useAssetOptions } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, todayISO } from '@/lib/utils';

type Line = { asset: Pick<AssetRow, 'id' | 'code' | 'name' | 'status' | 'departmentName' | 'custodianName' | 'originalCost' | 'bookValue' | 'serialNumber' | 'model'>; amount: string; condition: string; note: string };

/** Nhóm loại chứng từ cho hộp chọn */
const TYPE_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Luân chuyển', keys: ['CAP_PHAT', 'DIEU_CHUYEN', 'THU_HOI'] },
  { label: 'Kỹ thuật', keys: ['BAO_HONG', 'SUA_CHUA', 'HOAN_THANH_SUA', 'BAO_DUONG', 'KIEM_DINH'] },
  { label: 'Giá trị & ghi giảm', keys: ['DANH_GIA_LAI', 'DE_NGHI_THANH_LY', 'THANH_LY', 'BAO_MAT'] },
];
const CONDITION_TYPES = ['BAO_HONG', 'THU_HOI', 'HOAN_THANH_SUA', 'KIEM_DINH', 'BAO_DUONG', 'DIEU_CHUYEN', 'CAP_PHAT'];
const SUPPLIER_TYPES = ['SUA_CHUA', 'HOAN_THANH_SUA', 'BAO_DUONG', 'KIEM_DINH', 'THANH_LY'];

interface TxDetail {
  id: number; code: string; type: string; status: string; txDate: string; toDepartmentId: number | null; toLocationId: number | null; toCustodianId: number | null; toCustodianName: string;
  delivererName: string; receiverName: string; reason: string; decisionNo: string; supplierId: number | null; note: string;
  items: (Line['asset'] & { assetId: number; amount: number; condition: string; note: string })[];
  can: { edit: boolean };
}

function CreateContent() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useAuth((s) => s.can);
  const meta = useAssetMeta();
  const opts = useAssetOptions();
  const locs = useAssetCatalog('locations', true);
  const sups = useAssetCatalog('suppliers', true);
  const editId = params.get('edit');

  const [type, setType] = useState(params.get('type') ?? '');
  const [h, setH] = useState<Record<string, string>>({ txDate: todayISO() });
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editId && !params.get('ids'));

  // Tải sẵn tài sản từ ?ids= hoặc chứng từ cần sửa
  useEffect(() => {
    (async () => {
      try {
        if (editId) {
          const t = await apiFetch<TxDetail>(`/asset-transactions/${editId}`);
          if (!t.can.edit) {
            toast.error('Chứng từ này không còn sửa được');
            router.replace(`/tai-san/nghiep-vu/${editId}`);
            return;
          }
          setType(t.type);
          const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
          setH({
            txDate: t.txDate, toDepartmentId: s(t.toDepartmentId), toLocationId: s(t.toLocationId), toCustodianId: s(t.toCustodianId), toCustodianName: t.toCustodianName,
            delivererName: t.delivererName, receiverName: t.receiverName, reason: t.reason, decisionNo: t.decisionNo, supplierId: s(t.supplierId), note: t.note,
          });
          setLines(t.items.map((i) => ({ asset: { ...i, id: i.assetId }, amount: Number(i.amount) ? String(i.amount) : '', condition: i.condition, note: i.note })));
        } else if (params.get('ids')) {
          const r = await apiFetch<{ items: AssetRow[] }>(`/assets?ids=${params.get('ids')}&all=true&status=`);
          setLines(r.items.map((a) => ({ asset: a, amount: '', condition: '', note: '' })));
        }
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tm = meta.data?.txTypes?.[type];
  const invalid = useMemo(() => (tm ? lines.filter((l) => !tm.allowed.includes(l.asset.status)) : []), [lines, tm]);
  const set = (k: string, v: string) => setH((s) => ({ ...s, [k]: v }));
  const setLine = (i: number, k: keyof Omit<Line, 'asset'>, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const users = (opts.data?.users ?? []).filter((u) => !h.toDepartmentId || u.departmentId === Number(h.toDepartmentId));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const save = async (mode: 'draft' | 'submit' | 'approve') => {
    if (!type) return toast.error('Chọn loại chứng từ');
    if (!lines.length) return toast.error('Chưa chọn tài sản');
    if (invalid.length) return toast.error(`${invalid.length} tài sản không hợp lệ cho chứng từ này — hãy bỏ ra`);
    setBusy(mode);
    const body = {
      type,
      ...h,
      items: lines.map((l) => ({ assetId: l.asset.id, amount: Number(l.amount) || 0, condition: l.condition, note: l.note })),
      ...(mode === 'submit' ? { submit: true } : {}),
      ...(mode === 'approve' ? { approveNow: true } : {}),
    };
    try {
      let id: number;
      if (editId) {
        await apiFetch(`/asset-transactions/${editId}`, { method: 'PUT', body });
        id = Number(editId);
        if (mode === 'submit') await apiFetch(`/asset-transactions/${id}/submit`, { method: 'POST' });
        if (mode === 'approve') await apiFetch(`/asset-transactions/${id}/approve`, { method: 'POST' });
      } else {
        const r = await apiFetch<{ id: number }>('/asset-transactions', { method: 'POST', body });
        id = r.id;
      }
      toast.success(mode === 'approve' ? 'Đã duyệt và áp dụng vào tài sản' : mode === 'submit' ? 'Đã gửi duyệt' : 'Đã lưu nháp');
      router.push(`/tai-san/nghiep-vu/${id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/tai-san">Quản lý tài sản</Link> / <Link href="/tai-san/nghiep-vu">Chứng từ</Link> / {editId ? 'Sửa' : 'Lập mới'}
          </>
        }
        title={editId ? 'Sửa chứng từ' : 'Lập chứng từ nghiệp vụ'}
        description="Chứng từ chỉ tác động vào tài sản khi được duyệt. Mỗi tài sản chỉ nằm trong một chứng từ chờ duyệt tại một thời điểm."
      />
      <AssetSubnav />

      {/* Bước 1: loại chứng từ */}
      <Card className="p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-teal-700">1. Loại nghiệp vụ</div>
        <div className="grid gap-3 lg:grid-cols-3">
          {TYPE_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="mb-1 text-[11px] font-medium text-[var(--muted-foreground)]">{g.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.keys.map((k) => {
                  const t = meta.data?.txTypes?.[k];
                  if (!t) return null;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={Boolean(editId)}
                      onClick={() => setType(k)}
                      title={t.description}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed',
                        type === k ? 'border-teal-600 bg-teal-600 text-white shadow-sm' : 'bg-[var(--card)] hover:border-teal-400 disabled:opacity-50',
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {tm ? (
          <div className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900">
            {tm.description} <span className="text-teal-700">· Áp dụng cho tài sản đang: {tm.allowed.map((s) => ASSET_STATUS[s]?.label ?? s).join(', ')}</span>
          </div>
        ) : null}
      </Card>

      {/* Bước 2: thông tin chứng từ */}
      <Card className={cn('p-4', !type && 'pointer-events-none opacity-50')}>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-teal-700">2. Thông tin chứng từ</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Ngày chứng từ</span>
            <Input type="date" value={h.txDate ?? ''} onChange={(e) => set('txDate', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Số quyết định / biên bản</span>
            <Input value={h.decisionNo ?? ''} onChange={(e) => set('decisionNo', e.target.value)} placeholder="Số 123/QĐ-BV" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Người giao</span>
            <Input value={h.delivererName ?? ''} onChange={(e) => set('delivererName', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Người nhận</span>
            <Input value={h.receiverName ?? ''} onChange={(e) => set('receiverName', e.target.value)} />
          </label>
          {tm?.needsTarget || type === 'THU_HOI' ? (
            <>
              {type !== 'THU_HOI' ? (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--muted-foreground)]">Đến khoa/phòng {tm?.needsTarget ? '*' : ''}</span>
                  <Select value={h.toDepartmentId ?? ''} onChange={(e) => (set('toDepartmentId', e.target.value), set('toCustodianId', ''))}>
                    <option value="">—</option>
                    {(opts.data?.departments ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">{type === 'THU_HOI' ? 'Vị trí kho' : 'Đến vị trí'}</span>
                <Select value={h.toLocationId ?? ''} onChange={(e) => set('toLocationId', e.target.value)}>
                  <option value="">—</option>
                  {(locs.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {treeLabel(c)}
                    </option>
                  ))}
                </Select>
              </label>
              {type !== 'THU_HOI' ? (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--muted-foreground)]">Người giữ mới</span>
                  <Select value={h.toCustodianId ?? ''} onChange={(e) => set('toCustodianId', e.target.value)}>
                    <option value="">—</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.username})
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
            </>
          ) : null}
          {SUPPLIER_TYPES.includes(type) ? (
            <label className="space-y-1">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">Đơn vị thực hiện / mua</span>
              <Select value={h.supplierId ?? ''} onChange={(e) => set('supplierId', e.target.value)}>
                <option value="">— Nội bộ —</option>
                {(sups.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="space-y-1 sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Lý do / nội dung</span>
            <Textarea rows={2} value={h.reason ?? ''} onChange={(e) => set('reason', e.target.value)} />
          </label>
        </div>
      </Card>

      {/* Bước 3: tài sản */}
      <Card className={cn('overflow-hidden', !type && 'pointer-events-none opacity-50')}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">3. Tài sản ({lines.length})</div>
          <div className="flex gap-2">
            {invalid.length ? (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setLines((ls) => ls.filter((l) => tm?.allowed.includes(l.asset.status)))}>
                Bỏ {invalid.length} tài sản không hợp lệ
              </Button>
            ) : null}
            <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setPicker(true)}>
              <Plus className="size-4" /> <ScanLine className="size-4" /> Thêm / quét mã
            </Button>
          </div>
        </div>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Tài sản</th>
                <th className="p-2">Hiện tại</th>
                <th className="p-2 text-right">Còn lại</th>
                {tm?.amountLabel ? <th className="p-2 text-right">{tm.amountLabel}</th> : null}
                {CONDITION_TYPES.includes(type) ? <th className="p-2">Tình trạng</th> : null}
                <th className="p-2">Ghi chú</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const bad = tm && !tm.allowed.includes(l.asset.status);
                return (
                  <tr key={l.asset.id} className={cn('border-t align-top', bad && 'bg-red-50')}>
                    <td className="p-2 text-xs tabular-nums">{i + 1}</td>
                    <td className="min-w-[220px] p-2">
                      <div className="font-mono text-xs font-semibold text-teal-700">{l.asset.code}</div>
                      <div>{l.asset.name}</div>
                      {bad ? <div className="text-[11px] text-red-600">Không hợp lệ cho {tm?.label}</div> : null}
                    </td>
                    <td className="p-2 text-xs">
                      <AssetStatus status={l.asset.status} />
                      <div className="mt-0.5 text-[var(--muted-foreground)]">
                        {l.asset.departmentName ?? 'Kho'}
                        {l.asset.custodianName ? ` · ${l.asset.custodianName}` : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">{money(l.asset.bookValue)}</td>
                    {tm?.amountLabel ? (
                      <td className="p-2">
                        <Input type="number" min={0} className="h-8 w-36 text-right" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} placeholder={type === 'DANH_GIA_LAI' ? money(l.asset.originalCost) : '0'} />
                      </td>
                    ) : null}
                    {CONDITION_TYPES.includes(type) ? (
                      <td className="p-2">
                        <Select className="h-8 w-32" value={l.condition} onChange={(e) => setLine(i, 'condition', e.target.value)}>
                          <option value="">Giữ nguyên</option>
                          {Object.entries(ASSET_CONDITION).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </td>
                    ) : null}
                    <td className="p-2">
                      <Input className="h-8 min-w-[160px]" value={l.note} onChange={(e) => setLine(i, 'note', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Bỏ">
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!lines.length ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-sm text-[var(--muted-foreground)]">
                    Chưa có tài sản — bấm <b>Thêm / quét mã</b> hoặc dùng máy quét mã vạch.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {tm?.amountLabel && lines.length ? (
              <tfoot>
                <tr className="border-t bg-[var(--muted)]/50 font-semibold">
                  <td colSpan={4} className="p-2 text-right text-xs">
                    Tổng {tm.amountLabel.toLowerCase()}
                  </td>
                  <td className="p-2 text-right tabular-nums">{money(total)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <div className="sticky bottom-2 z-10 flex flex-wrap justify-end gap-2 rounded-xl border bg-[var(--card)]/95 p-3 shadow-lg backdrop-blur">
        <Button variant="outline" onClick={() => router.back()}>
          Huỷ
        </Button>
        <Button variant="outline" loading={busy === 'draft'} disabled={!!busy} onClick={() => save('draft')}>
          Lưu nháp
        </Button>
        <Button variant="subtle" loading={busy === 'submit'} disabled={!!busy} onClick={() => save('submit')}>
          Gửi duyệt
        </Button>
        {can('asset.transaction.approve') ? (
          <Button className="bg-teal-600 hover:bg-teal-700" loading={busy === 'approve'} disabled={!!busy} onClick={() => save('approve')}>
            Lưu & duyệt ngay
          </Button>
        ) : null}
      </div>

      <AssetPicker
        open={picker}
        onClose={() => setPicker(false)}
        allowedStatuses={tm?.allowed}
        exclude={lines.map((l) => l.asset.id)}
        title={tm ? `Chọn tài sản — ${tm.label}` : 'Chọn tài sản'}
        onPick={(rows) => setLines((ls) => [...ls, ...rows.map((a) => ({ asset: a, amount: '', condition: '', note: '' }))])}
      />
    </div>
  );
}

export default function TxCreatePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CreateContent />
    </Suspense>
  );
}
