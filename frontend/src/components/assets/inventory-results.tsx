'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eraser, Pencil, Search, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AssetStatus, DueBadge, Field, Pill } from '@/components/assets/asset-ui';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { ASSET_CONDITION, money, useAssetOptions } from '@/lib/assets';
import { CHECK_BUTTON, INVENTORY_RESOLUTION, INVENTORY_RESULT, type InventoryItemRow } from '@/lib/inventory';
import { cn, formatDate } from '@/lib/utils';
import type { InventoryDetail } from '@/app/(app)/tai-san/kiem-ke/[id]/page';

const stateMap: Record<string, { label: string; color: string }> = {
  CO: { label: 'Có', color: '#16a34a' },
  KHONG_THAY: { label: 'Không thấy', color: '#dc2626' },
  CHUA_KIEM: { label: 'Chưa kiểm', color: '#64748b' },
};

/** Bộ lọc + bảng chi tiết dòng kiểm kê */
export function InventoryResults({ id, detail: d }: { id: number; detail: InventoryDetail }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ q: '', result: '', checkState: '', departmentId: '', expected: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<InventoryItemRow | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const opts = useAssetOptions();
  const qs = new URLSearchParams({ page: String(page), pageSize: '100', ...(f.q ? { q: f.q } : {}), ...(f.result ? { result: f.result } : {}), ...(f.checkState ? { checkState: f.checkState } : {}), ...(f.departmentId ? { departmentId: f.departmentId } : {}), ...(f.expected ? { expected: f.expected } : {}) });
  const q = useQuery({
    queryKey: ['asset-inventory-items', id, qs.toString()],
    queryFn: () => apiFetch<{ items: InventoryItemRow[]; total: number; page: number; pageSize: number }>(`/asset-inventories/${id}/items?${qs}`),
    placeholderData: keepPreviousData,
    refetchInterval: d.status === 'DANG_KIEM_KE' ? 15_000 : false,
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 100));

  const patch = useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: Record<string, unknown> }) => apiFetch(`/asset-inventories/${id}/items/${itemId}`, { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['asset-inventory-items', id] });
      void qc.invalidateQueries({ queryKey: ['asset-inventory', id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (itemId: number) => apiFetch(`/asset-inventories/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['asset-inventory-items', id] });
      void qc.invalidateQueries({ queryKey: ['asset-inventory', id] });
      toast.success('Đã xoá dòng thừa quét nhầm');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/asset-inventories/${id}/items/bulk`, { method: 'POST', body }),
    onSuccess: () => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['asset-inventory-items', id] });
      void qc.invalidateQueries({ queryKey: ['asset-inventory', id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const diffOnly = (it: InventoryItemRow) => ['SAI_VI_TRI', 'SAI_TINH_TRANG', 'THUA', 'KHONG_RO', 'KHOP'].includes(it.result);
  const canEditLine = (it: InventoryItemRow) =>
    (d.status === 'DANG_KIEM_KE' && (d.can.scan || d.can.edit)) || (d.status === 'CHO_DUYET' && d.can.resolve);
  const lintCls = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-[var(--muted)]';

  const allSelected = items.length > 0 && items.filter((i) => i.expected).every((i) => selected.has(i.id));
  const pendingIds = items.filter((i) => i.expected && i.checkState === 'CHUA_KIEM').map((i) => i.id);
  const selectCls = 'h-8 rounded-lg border bg-transparent px-2 text-xs focus-visible:outline-none';

  return (
    <div className="space-y-3">
      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            placeholder="Mã, tên, serial…"
            value={f.q}
            onChange={(e) => { setF((x) => ({ ...x, q: e.target.value })); setPage(1); }}
            className="h-8 w-48 rounded-lg border bg-transparent pl-8 pr-7 text-sm focus-visible:border-teal-500 focus-visible:outline-none"
          />
          {f.q && (
            <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" onClick={() => setF((x) => ({ ...x, q: '' }))} aria-label="Xoá">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <select className={selectCls} value={f.result} onChange={(e) => { setF((x) => ({ ...x, result: e.target.value })); setPage(1); }}>
          <option value="">Kết quả: tất cả</option>
          <option value="PENDING">Chưa có kết quả</option>
          {Object.entries(INVENTORY_RESULT).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className={selectCls} value={f.checkState} onChange={(e) => { setF((x) => ({ ...x, checkState: e.target.value })); setPage(1); }}>
          <option value="">Trạng thái kiểm: tất cả</option>
          {Object.entries(stateMap).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className={selectCls} value={f.departmentId} onChange={(e) => { setF((x) => ({ ...x, departmentId: e.target.value })); setPage(1); }}>
          <option value="">Khoa (sổ sách): tất cả</option>
          <option value="-1">Kho / chưa cấp phát</option>
          {(opts.data?.departments ?? []).map((dp) => (
            <option key={dp.id} value={dp.id}>{dp.name}</option>
          ))}
        </select>
        <select className={selectCls} value={f.expected} onChange={(e) => { setF((x) => ({ ...x, expected: e.target.value })); setPage(1); }}>
          <option value="">Sổ + quét thêm</option>
          <option value="true">Chỉ theo sổ sách</option>
          <option value="false">Chỉ quét phát hiện thêm</option>
        </select>
        {(f.q || f.result || f.checkState || f.departmentId || f.expected) && (
          <Button variant="ghost" size="sm" onClick={() => { setF({ q: '', result: '', checkState: '', departmentId: '', expected: '' }); setPage(1); }}>
            <Eraser className="size-3.5" /> Xoá lọc
          </Button>
        )}
        {selected.size > 0 && (d.status === 'DANG_KIEM_KE' || d.status === 'CHO_DUYET') && d.can.resolve && (
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <b>{selected.size}</b> dòng chọn:
            <Button size="sm" variant="outline" onClick={() => bulk.mutate({ itemIds: [...selected], checkState: 'CO' })}>Có mặt</Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => bulk.mutate({ itemIds: [...selected], checkState: 'KHONG_THAY' })}>Không thấy</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(pendingIds))}>Chọn chưa kiểm</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Bỏ chọn</Button>
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{total.toLocaleString('vi-VN')} dòng</span>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Card className="overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[1150px] text-sm">
              <thead>
                <tr className="border-b bg-[var(--muted)]/50 text-left text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="w-8 px-2 py-2">
                    <input type="checkbox" className="accent-teal-600" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(items.filter((i) => i.expected).map((i) => i.id)) : new Set())} aria-label="Chọn tất cả" />
                  </th>
                  <th className="px-3 py-2 font-medium">Tài sản</th>
                  <th className="px-3 py-2 font-medium">Theo sổ sách</th>
                  <th className="px-3 py-2 text-right font-medium">Giá trị còn lại</th>
                  <th className="px-3 py-2 font-medium">Thực tế</th>
                  <th className="px-3 py-2 font-medium">Kết quả</th>
                  <th className="px-3 py-2 font-medium">Ngườ i kiểm</th>
                  <th className="px-3 py-2 font-medium">Xử lý</th>
                  <th className="w-16 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
                      Không có dòng nào khớp bộ lọc
                    </td>
                  </tr>
                )}
                {items.map((it) => {
                  const isState = stateMap[it.checkState] ?? stateMap.CHUA_KIEM;
                  const res = INVENTORY_RESULT[it.result];
                  const low = it.result === 'THIEU' || it.result === 'KHONG_RO';
                  const edit = canEditLine(it) && !it.resolutionTxId;
                  return (
                    <tr key={it.id} className={cn('border-b last:border-0 align-top', low ? 'bg-red-50/60 dark:bg-red-950/20' : it.result === 'SAI_VI_TRI' || it.result === 'SAI_TINH_TRANG' ? 'bg-amber-50/50 dark:bg-amber-950/10' : it.result === 'THUA' ? 'bg-purple-50/50 dark:bg-purple-950/10' : 'hover:bg-[var(--muted)]/30')}>
                      <td className="px-2 py-2">
                        {it.expected && (
                          <input
                            type="checkbox"
                            className="accent-teal-600"
                            checked={selected.has(it.id)}
                            onChange={(e) => setSelected((s) => { const t = new Set(s); e.target.checked ? t.add(it.id) : t.delete(it.id); return t; })}
                            aria-label="Chọn"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{it.code}</div>
                        <div className="max-w-[260px] truncate font-medium">{it.name}</div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">{[it.model, it.serialNumber].filter(Boolean).join(' · ') || '—'}</div>
                        {!it.expected && <span className="mt-0.5 inline-block rounded bg-purple-100 px-1 text-[10px] font-bold text-purple-700 dark:bg-purple-950">QUÉT THÊM</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {it.expected ? (
                          <>
                            <div className="font-medium">{it.bookDepartmentName ?? 'Kho'}</div>
                            <div className="text-[var(--muted-foreground)]">{it.bookLocationName ?? ''}{it.bookCustodianName ? ` · ${it.bookCustodianName}` : ''}</div>
                            <div>{ASSET_CONDITION[it.bookCondition] ?? ''}</div>
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">Ngoài sổ đợt này</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {it.expected && (
                          <>
                            <div className="tabular-nums">{money(it.bookValue)}</div>
                            <div className="text-[10px] text-[var(--muted-foreground)]">NG {money(it.bookCost)}</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {it.checkState === 'CO' ? (
                          <>
                            <div className="font-medium">{it.actualDepartmentName ?? 'Kho'}</div>
                            <div className="text-[var(--muted-foreground)]">{it.actualLocationName ?? ''}</div>
                            {it.actualCondition && <div>{ASSET_CONDITION[it.actualCondition] ?? ''}</div>}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                        <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{it.checkedAt ? formatDate(it.checkedAt) : ''}{it.scanCount > 1 ? ` · quét ${it.scanCount} lần` : ''}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Pill color={isState.color}>{isState.label}</Pill>
                          {res && <Pill color={res.color}>{res.label}</Pill>}
                          {it.note && <span className="text-[10px] italic text-[var(--muted-foreground)]">{it.note}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">{it.checkedByName || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {it.resolutionTxId ? (
                          <Link href={`/tai-san/nghiep-vu/${it.resolutionTxId}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                            {INVENTORY_RESOLUTION[it.resolution]?.label ?? 'Đã lập chứng từ'} →
                          </Link>
                        ) : it.resolution === 'GHI_NHAN' ? (
                          <span className="text-[var(--muted-foreground)]">Đã ghi nhận</span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-0.5">
                          {edit && (
                            <button onClick={() => setEditing(it)} className={lintCls} title="Sửa dòng">
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                          {it.assetId && (
                            <Link href={`/tai-san/${it.assetId}`} className={lintCls} title="Hồ sơ tài sản">→
                            </Link>
                          )}
                          {!it.expected && (d.status === 'DANG_KIEM_KE' || d.status === 'CHO_DUYET') && (
                            <button onClick={() => del.mutate(it.id)} className={cn(lintCls, 'text-red-600 hover:bg-red-50')} title="Xoá dòng quét nhầm">
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs">Trang {page}/{pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </Card>
      )}

      <ItemEditDialog id={id} item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['asset-inventory-items', id] }); void qc.invalidateQueries({ queryKey: ['asset-inventory', id] }); }} />
    </div>
  );
}

/** Hộp thoại sửa một dòng kiểm kê (vị trí/tình trạng thực tế, có / không thấy / chưa kiểm) */
function ItemEditDialog({ id, item, onClose, onSaved }: { id: number; item: InventoryItemRow | null; onClose: () => void; onSaved: () => void }) {
  const opts = useAssetOptions();
  const [form, setForm] = useState({ checkState: '', actualDepartmentId: '', actualCondition: '', note: '' });
  const [saving, setSaving] = useState(false);
  useMemo(() => {
    if (item) setForm({ checkState: item.checkState, actualDepartmentId: String(item.actualDepartmentId ?? ''), actualCondition: item.actualCondition ?? '', note: item.note ?? '' });
  }, [item]);

  if (!item) return null;
  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/asset-inventories/${id}/items/${item.id}`, {
        method: 'PUT',
        body: {
          checkState: form.checkState,
          ...(form.checkState === 'CO' ? { actualDepartmentId: form.actualDepartmentId ? Number(form.actualDepartmentId) : null, actualCondition: form.actualCondition || undefined } : {}),
          note: form.note,
        },
      });
      toast.success('Đã cập nhật dòng kiểm kê');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`${item.code} — ${item.name}`} description={item.expected ? `Sổ sách: ${item.bookDepartmentName ?? 'Kho'}${item.bookLocationName ? ` · ${item.bookLocationName}` : ''} · tình trạng ${ASSET_CONDITION[item.bookCondition] ?? ''}` : 'Tài sản quét phát hiện thêm (ngoài phạm vi đợt)'}>
      <div className="space-y-3 px-4 py-3">
        <Field label="Kết quả kiểm">
          <div className="flex gap-2">
            {(['CO', 'KHONG_THAY', 'CHUA_KIEM'] as const).filter((k) => item.expected || k === 'CO').map((k) => (
              <button
                key={k}
                onClick={() => setForm((f) => ({ ...f, checkState: k }))}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  form.checkState === k ? 'border-transparent text-white shadow-sm' : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                )}
                style={form.checkState === k ? { backgroundColor: CHECK_BUTTON[k].color } : {}}
                type="button"
              >
                {CHECK_BUTTON[k].label}
              </button>
            ))}
          </div>
        </Field>
        {form.checkState === 'CO' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Khoa/phòng thực tế">
              <select className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm" value={form.actualDepartmentId} onChange={(e) => setForm((f) => ({ ...f, actualDepartmentId: e.target.value }))}>
                <option value="">Kho / chưa cấp phát</option>
                {(opts.data?.departments ?? []).map((dp) => (
                  <option key={dp.id} value={dp.id}>{dp.name}</option>
                ))}
              </select>
              {item.actualDepartmentId !== item.bookDepartmentId && form.actualDepartmentId && Number(form.actualDepartmentId) !== item.bookDepartmentId && (
                <p className="mt-1 text-[11px] text-amber-600">Khác sổ sách ({item.bookDepartmentName ?? 'Kho'})</p>
              )}
            </Field>
            <Field label="Tình trạng thực tế">
              <select className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm" value={form.actualCondition} onChange={(e) => setForm((f) => ({ ...f, actualCondition: e.target.value }))}>
                <option value="">Giữ sổ sách ({ASSET_CONDITION[item.bookCondition] ?? '…'})</option>
                {Object.entries(ASSET_CONDITION).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <Field label="Ghi chú">
          <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="VD: Không lên nguồn, thiếu phụ kiện…" />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button disabled={saving} onClick={() => void save()}>Lưu</Button>
        </div>
      </div>
    </Dialog>
  );
}
