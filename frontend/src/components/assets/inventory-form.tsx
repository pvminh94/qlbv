'use client';

import { ClipboardList, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/assets/asset-ui';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { GROUP_COLORS, money, treeLabel, useAssetCatalog, useAssetMeta, useAssetOptions } from '@/lib/assets';
import type { InventoryRow } from '@/lib/inventory';
import { cn, formatDate } from '@/lib/utils';

export interface Scope {
  departmentIds: number[];
  locationIds: number[];
  categoryIds: number[];
  groups: string[];
  includeStore: boolean;
}

/** Hộp thoại lập / sửa đợt kiểm kê (tên, phạm vi, hội đồng, phân công quét, kiểm kê mù) */
export function InventoryFormDialog({
  open,
  onClose,
  onSaved,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  editing: InventoryRow | null;
}) {
  const meta = useAssetMeta();
  const opts = useAssetOptions();
  const cats = useAssetCatalog('categories', true);
  const locs = useAssetCatalog('locations', true);
  const [form, setForm] = useState({
    name: '', plannedDate: '', decisionNo: '', note: '', blind: false, memberText: '',
    scope: { departmentIds: [], locationIds: [], categoryIds: [], groups: [], includeStore: true } as Scope,
    committee: [] as { name: string; position: string; role: string }[],
  });
  const groups = meta.data?.groups ?? {};
  const users = useMemo(() => (opts.data?.users ?? []) as { id: number; fullName: string; department?: string }[], [opts.data]);
  const depts = useMemo(() => (opts.data?.departments ?? []) as { id: number; name: string }[], [opts.data]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        plannedDate: editing.plannedDate ?? '',
        decisionNo: editing.decisionNo ?? '',
        note: editing.note ?? '',
        blind: editing.blind,
        memberText: '',
        scope: {
          departmentIds: editing.scope?.departmentIds ?? [],
          locationIds: editing.scope?.locationIds ?? [],
          categoryIds: editing.scope?.categoryIds ?? [],
          groups: editing.scope?.groups ?? [],
          includeStore: editing.scope?.includeStore !== false,
        },
        committee: (editing.committee ?? []).map((m) => ({ name: m.name, position: m.position ?? '', role: m.role ?? '' })),
      });
    } else {
      setForm({ name: '', plannedDate: '', decisionNo: '', note: '', blind: false, memberText: '', scope: { departmentIds: [], locationIds: [], categoryIds: [], groups: [], includeStore: true }, committee: [{ name: '', position: '', role: 'Chủ tịch hội đồng' }] });
    }
  }, [open, editing]);

  const toggle = <K extends 'departmentIds' | 'locationIds' | 'categoryIds' | 'groups'>(key: K, id: Scope[K][number]) =>
    setForm((f) => ({
      ...f,
      scope: {
        ...f.scope,
        [key]: (f.scope[key] as unknown[]).includes(id as unknown) ? (f.scope[key] as unknown[]).filter((x) => x !== id) : [...f.scope[key], id],
      } as Scope,
    }));

  const scopeBody = form.scope;
  const denom = useMemo(() => JSON.stringify({ d: scopeBody.departmentIds, l: scopeBody.locationIds, c: scopeBody.categoryIds, g: scopeBody.groups, s: scopeBody.includeStore }), [scopeBody]);
  const [preview, setPreview] = useState<{ count: number; cost: number; bookValue: number; departments: number; store: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => setPreview(null), [denom, open]);
  const doPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await apiFetch('/asset-inventories/scope-preview', { method: 'POST', body: { scope: scopeBody } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  };
  const metaGroups = Object.entries(groups as Record<string, string>);

  const [saving, setSaving] = useState(false);
  const members = form.memberText
    .split(',')
    .map((t) => users.find((u) => u.fullName === t.trim()))
    .filter((u): u is { id: number; fullName: string } => !!u)
    .map((u) => u.id);
  useEffect(() => {
    if (open && editing) setForm((f) => ({ ...f, memberText: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (start = false) => {
    if (!form.name.trim()) return toast.error('Chưa nhập tên đợt kiểm kê');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(), plannedDate: form.plannedDate || null, decisionNo: form.decisionNo.trim(), note: form.note.trim(),
        blind: form.blind, memberIds: members, committee: form.committee.filter((c) => c.name.trim()),
        scope: scopeBody, ...(editing?.status === 'NHAP' || !editing ? {} : {}), ...(start ? { start: true } : {}),
      };
      const r = editing
        ? await apiFetch<{ id: number }>(`/asset-inventories/${editing.id}`, { method: 'PUT', body })
        : await apiFetch<{ id: number }>('/asset-inventories', { method: 'POST', body });
      toast.success(start ? 'Đã lập và bắt đầu đợt kiểm kê' : 'Đã lưu đợt kiểm kê');
      onSaved(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const scopeEditable = !editing || editing.status === 'NHAP';
  const inputCls =
    'h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm shadow-sm transition-colors focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/20 focus-visible:outline-none';

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Sửa đợt kiểm kê ${editing.code}` : 'Lập đợt kiểm kê mới'} size="xl">

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tên đợt kiểm kê *" className="sm:col-span-2">
              <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="VD: Kiểm kê cuối năm 2026 — Toàn viện" />
            </Field>
            <Field label="Ngày dự kiến">
              <Input type="date" value={form.plannedDate} onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))} />
            </Field>
            <Field label="Quyết định kiểm kê">
              <Input value={form.decisionNo} onChange={(e) => setForm((f) => ({ ...f, decisionNo: e.target.value }))} placeholder="Số QĐ thành lập hội đồng" />
            </Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Thành phần hội đồng / Ban kiểm kê</span>
              <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, committee: [...f.committee, { name: '', position: '', role: 'Uỷ viên' }] }))}>
                <Plus className="size-3.5" /> Thêm ngườ'i
              </Button>
            </div>
            <div className="space-y-2">
              {form.committee.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="flex-[2]" placeholder="Họ tên" value={c.name} onChange={(e) => setForm((f) => ({ ...f, committee: f.committee.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)) }))} />
                  <Input className="flex-[2]" placeholder="Chức vụ" value={c.position} onChange={(e) => setForm((f) => ({ ...f, committee: f.committee.map((x, xi) => (xi === i ? { ...x, position: e.target.value } : x)) }))} />
                  <Input className="flex-[1.5]" placeholder="Trong ban: Chủ tịch, Uỷ viên…" value={c.role} onChange={(e) => setForm((f) => ({ ...f, committee: f.committee.map((x, xi) => (xi === i ? { ...x, role: e.target.value } : x)) }))} />
                  <button type="button" className="text-[var(--muted-foreground)] hover:text-red-600" onClick={() => setForm((f) => ({ ...f, committee: f.committee.filter((_, xi) => xi !== i) }))} aria-label="Xoá">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <Field label="Phân công quét (ngườ có quyền quét trong đợt này) — chọn nhiều">
            <Input list="inv-users" value={form.memberText} onChange={(e) => setForm((f) => ({ ...f, memberText: e.target.value }))} placeholder="Gõ tên, cách nhau bởi dấu phẩy — để trống nếu chỉ quản lý kiểm kê quét" />
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              Đã chọn: {members.length ? members.length + ' ngườ' : 'chưa — chỉ ngườ có quyền điều hành kiểm kê quét được'}
            </p>
          </Field>
          <Field label="Ghi chú">
            <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Ghi chú nội bộ" />
          </Field>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 accent-teal-600" checked={form.blind} onChange={(e) => setForm((f) => ({ ...f, blind: e.target.checked }))} />
            <span>
              <span className="flex items-center gap-1.5 font-semibold"><EyeOff className="size-4 text-purple-600" /> Kiểm kê mù (blind count)</span>
              <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">Ngườ i quét không thấy danh sách theo sổ sách — lực lượng độc lập chỉ quét nhữ gì thực có, tránh ảnh hưởng. Quản lý kiểm kê vẫn thấy đầy đủ.</span>
            </span>
          </label>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-semibold"><ClipboardList className="size-4 text-teal-600" /> Phạm vi kiểm kê</span>
              {!scopeEditable && <span className="text-[10px] text-amber-600">Đã chốt</span>}
            </div>
            <Field label="Khoa/phòng (trống = toàn viện)" className="mb-2">
              <select multiple disabled={!scopeEditable} value={form.scope.departmentIds.map(String)} onChange={(e) => setForm((f) => ({ ...f, scope: { ...f.scope, departmentIds: [...e.target.selectedOptions].map((o) => Number(o.value)) } }))} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none" size={8}>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <input type="checkbox" className="accent-teal-600" disabled={!scopeEditable} checked={form.scope.includeStore} onChange={(e) => setForm((f) => ({ ...f, scope: { ...f.scope, includeStore: e.target.checked } }))} />
              Gồm cả tài sản trong kho (chưa cấp phát)
            </label>
            <Field label="Vị trí (gồm cây con)">
              <select multiple disabled={!scopeEditable} value={form.scope.locationIds.map(String)} onChange={(e) => setForm((f) => ({ ...f, scope: { ...f.scope, locationIds: [...e.target.selectedOptions].map((o) => Number(o.value)) } }))} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none" size={7}>
                {(locs.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{treeLabel(l as never)}</option>
                ))}
              </select>
            </Field>
            <Field label="Loại tài sản (gồm cây con)" className="my-2">
              <select multiple disabled={!scopeEditable} value={form.scope.categoryIds.map(String)} onChange={(e) => setForm((f) => ({ ...f, scope: { ...f.scope, categoryIds: [...e.target.selectedOptions].map((o) => Number(o.value)) } }))} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none" size={7}>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{treeLabel(c as never)}</option>
                ))}
              </select>
            </Field>
            <Field label="Nhóm tài sản">
              <div className="flex flex-wrap gap-1">
                {metaGroups.map(([k, label], i) => (
                  <button
                    key={k}
                    type="button"
                    disabled={!scopeEditable}
                    onClick={() => toggle('groups', k)}
                    className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition-colors', form.scope.groups.includes(k) ? 'text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}
                    style={form.scope.groups.includes(k) ? { backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] } : {}}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Button variant="outline" size="sm" className="mt-2 w-full" disabled={previewing} onClick={doPreview}>
              <RefreshCw className={cn('size-3.5', previewing && 'animate-spin')} /> Đếm tài sản trong phạm vi
            </Button>
            {preview && (
              <div className="mt-2 rounded-lg bg-teal-50 p-2.5 text-xs leading-relaxed text-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
                <b>{preview.count}</b> tài sản · nguyên giá <b>{money(preview.cost)}</b> đ<br />
                thuộc {preview.departments} khoa/phòng {preview.store ? `(gồm ${preview.store} tài sản trong kho)` : ''}
                {preview.count === 0 && <span className="mt-1 block font-semibold text-red-600">Không có tài sản nào — hãy nới phạm vi</span>}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-between gap-2 border-t pt-4">
        <div>{editing?.plannedDate && <span className="text-xs text-[var(--muted-foreground)]">Dự kiến: {formatDate(editing.plannedDate)}</span>}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          <Button disabled={saving} onClick={() => void save(false)}>Lưu</Button>
          {(!editing || editing.status === 'NHAP') && (
            <Button className="bg-teal-600 hover:bg-teal-700" disabled={saving} onClick={() => void save(true)}>
              Lưu & bắt đầu kiểm kê
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
