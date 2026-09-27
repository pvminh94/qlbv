'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Landmark, MapPin, Pencil, Plus, Search, Trash2, Truck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AssetSubnav, Pill } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { type CatalogItem, treeLabel, useAssetCatalog, useAssetMeta, useAssetOptions } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, normalizeVN } from '@/lib/utils';

type Kind = 'categories' | 'locations' | 'suppliers' | 'funding';
type FieldDef = { key: string; label: string; type: 'text' | 'number' | 'bool' | 'select' | 'parent' | 'dept' | 'roles' | 'textarea'; enumKey?: string; span?: 2 | 3; hint?: string };

const TABS: { key: Kind; label: string; icon: typeof FolderTree; desc: string }[] = [
  { key: 'categories', label: 'Loại tài sản', icon: FolderTree, desc: 'Cây phân loại; mỗi loại mang mặc định phương pháp khấu hao, thời gian sử dụng, tỉ lệ, chu kỳ kiểm định/bảo dưỡng và tiền tố mã.' },
  { key: 'locations', label: 'Vị trí', icon: MapPin, desc: 'Cây khu/tòa nhà → tầng → phòng → kho; có thể gắn với khoa/phòng quản lý.' },
  { key: 'suppliers', label: 'Nhà cung cấp / hãng', icon: Truck, desc: 'Hãng sản xuất, nhà cung cấp, đơn vị sửa chữa/bảo dưỡng/kiểm định.' },
  { key: 'funding', label: 'Nguồn vốn', icon: Landmark, desc: 'Ngân sách, sự nghiệp, viện trợ, quỹ phát triển…' },
];

const FIELDS: Record<Kind, FieldDef[]> = {
  categories: [
    { key: 'parentId', label: 'Thuộc loại', type: 'parent' },
    { key: 'codePrefix', label: 'Tiền tố mã tài sản', type: 'text', hint: 'vd TBYT → TBYT.2026.0001' },
    { key: 'kind', label: 'Phân loại', type: 'select', enumKey: 'kinds' },
    { key: 'group', label: 'Nhóm thống kê', type: 'select', enumKey: 'groups' },
    { key: 'depreciationMethod', label: 'Phương pháp khấu hao', type: 'select', enumKey: 'methods', span: 2 },
    { key: 'usefulLifeMonths', label: 'Thời gian sử dụng (tháng)', type: 'number' },
    { key: 'annualRate', label: 'Tỉ lệ hao mòn (%/năm)', type: 'number' },
    { key: 'maintenanceIntervalMonths', label: 'Chu kỳ bảo dưỡng (tháng)', type: 'number' },
    { key: 'requiresCalibration', label: 'Phải kiểm định', type: 'bool' },
    { key: 'calibrationIntervalMonths', label: 'Chu kỳ kiểm định (tháng)', type: 'number' },
  ],
  locations: [
    { key: 'parentId', label: 'Thuộc vị trí', type: 'parent' },
    { key: 'kind', label: 'Loại vị trí', type: 'select', enumKey: 'locationKinds' },
    { key: 'departmentId', label: 'Khoa/phòng quản lý', type: 'dept' },
  ],
  suppliers: [
    { key: 'roles', label: 'Vai trò', type: 'roles', span: 3 },
    { key: 'taxCode', label: 'Mã số thuế', type: 'text' },
    { key: 'country', label: 'Quốc gia', type: 'text' },
    { key: 'contactName', label: 'Người liên hệ', type: 'text' },
    { key: 'phone', label: 'Điện thoại', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'address', label: 'Địa chỉ', type: 'text', span: 3 },
  ],
  funding: [],
};

export default function AssetCatalogPage() {
  const can = useAuth((s) => s.can);
  const manage = can('asset.catalog.manage');
  const qc = useQueryClient();
  const meta = useAssetMeta();
  const opts = useAssetOptions();
  const [kind, setKind] = useState<Kind>('categories');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [del, setDel] = useState<CatalogItem | null>(null);
  const list = useAssetCatalog(kind);
  const tab = TABS.find((t) => t.key === kind)!;
  const enums = meta.data as unknown as Record<string, Record<string, string>> | undefined;

  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (!q.trim()) return all;
    const k = normalizeVN(q);
    return all.filter((r) => normalizeVN(`${r.code} ${r.name}`).includes(k));
  }, [list.data, q]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['asset-catalog'] });
  };
  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => (b.id ? apiFetch(`/asset-catalogs/${kind}/${b.id}`, { method: 'PUT', body: b }) : apiFetch(`/asset-catalogs/${kind}`, { method: 'POST', body: b })),
    onSuccess: () => {
      toast.success('Đã lưu');
      setEdit(null);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/asset-catalogs/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Đã xoá');
      setDel(null);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = (r: CatalogItem) => save.mutate({ id: r.id, active: !r.active });

  const set = (k: string, v: unknown) => setEdit((s) => ({ ...(s ?? {}), [k]: v }));
  const v = (k: string) => (edit?.[k] ?? '') as string;

  return (
    <div className="space-y-4">
      <PageHeader breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>} title="Danh mục tài sản" description="Danh mục dùng chung cho hồ sơ, chứng từ, báo cáo. Mục đang được dùng không xoá được — hãy ngừng sử dụng." />
      <AssetSubnav />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => (setKind(t.key), setQ(''))} className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-all', kind === t.key ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20' : 'bg-[var(--card)] hover:border-teal-300')}>
            <div className={cn('grid size-9 place-items-center rounded-lg', kind === t.key ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600')}>
              <t.icon className="size-5" />
            </div>
            <div className="text-sm font-semibold">{t.label}</div>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-xs text-[var(--muted-foreground)]">{tab.desc}</div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
              <Input className="w-56 pl-8" placeholder="Tìm mã, tên…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {manage ? (
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setEdit({ active: true, ...(kind === 'suppliers' ? { roles: ['NCC'] } : {}) })}>
                <Plus className="size-4" /> Thêm
              </Button>
            ) : null}
          </div>
        </div>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="p-2">Mã</th>
                <th className="p-2">Tên</th>
                {kind === 'categories' ? (
                  <>
                    <th className="p-2">Tiền tố</th>
                    <th className="p-2">Phương pháp</th>
                    <th className="p-2 text-right">TG SD</th>
                    <th className="p-2 text-right">Tỉ lệ</th>
                    <th className="p-2">Kiểm định</th>
                  </>
                ) : null}
                {kind === 'locations' ? <th className="p-2">Loại</th> : null}
                {kind === 'suppliers' ? (
                  <>
                    <th className="p-2">Vai trò</th>
                    <th className="p-2">Liên hệ</th>
                  </>
                ) : null}
                <th className="p-2 text-right">Đang dùng</th>
                <th className="p-2">Hoạt động</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={12} className="p-3">
                    <Skeleton className="h-24" />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={cn('border-t hover:bg-[var(--muted)]/40', !r.active && 'opacity-50')}>
                    <td className="whitespace-nowrap p-2 font-mono text-xs">{r.code}</td>
                    <td className={cn('p-2', (r.level ?? 1) === 1 && (kind === 'categories' || kind === 'locations') && 'font-semibold')}>{q ? r.name : treeLabel(r)}</td>
                    {kind === 'categories' ? (
                      <>
                        <td className="p-2 font-mono text-xs">{String(r.codePrefix ?? '')}</td>
                        <td className="p-2 text-[11px]">{meta.data?.methods?.[String(r.depreciationMethod)] ?? String(r.depreciationMethod ?? '')}</td>
                        <td className="p-2 text-right text-xs tabular-nums">{Number(r.usefulLifeMonths) ? `${Math.round(Number(r.usefulLifeMonths) / 12)} năm` : ''}</td>
                        <td className="p-2 text-right text-xs tabular-nums">{Number(r.annualRate) ? `${r.annualRate}%` : ''}</td>
                        <td className="p-2 text-xs">{r.requiresCalibration ? `${r.calibrationIntervalMonths || '?'} tháng` : ''}</td>
                      </>
                    ) : null}
                    {kind === 'locations' ? <td className="p-2 text-xs">{meta.data?.locationKinds?.[String(r.kind)] ?? String(r.kind ?? '')}</td> : null}
                    {kind === 'suppliers' ? (
                      <>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {((r.roles as string[]) ?? []).map((x) => (
                              <Pill key={x} color="#0d9488">{meta.data?.supplierRoles?.[x] ?? x}</Pill>
                            ))}
                          </div>
                        </td>
                        <td className="p-2 text-xs">{[r.contactName, r.phone].filter(Boolean).join(' · ') as string}</td>
                      </>
                    ) : null}
                    <td className="p-2 text-right tabular-nums">{r.usage ? <Link className="text-teal-700 hover:underline" href={`/tai-san/danh-sach?status=&${{ categories: 'categoryId', locations: 'locationId', suppliers: 'supplierId', funding: 'fundingSourceId' }[kind]}=${r.id}`}>{r.usage}</Link> : <span className="text-[var(--muted-foreground)]">0</span>}</td>
                    <td className="p-2">
                      <Switch checked={r.active} onCheckedChange={() => manage && toggle(r)} />
                    </td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {manage ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEdit({ ...r })}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600" disabled={r.usage > 0 || r.hasChildren} title={r.usage > 0 ? 'Đang được dùng' : r.hasChildren ? 'Còn mục con' : 'Xoá'} onClick={() => setDel(r)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title={`${edit?.id ? 'Sửa' : 'Thêm'} ${tab.label.toLowerCase()}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Huỷ
            </Button>
            <Button className="bg-teal-600 hover:bg-teal-700" loading={save.isPending} onClick={() => edit && save.mutate(edit)}>
              Lưu
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Mã *</span>
            <Input value={v('code')} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Tên *</span>
            <Input value={v('name')} onChange={(e) => set('name', e.target.value)} />
          </label>
          {FIELDS[kind].map((f) => (
            <label key={f.key} className={cn('space-y-1', f.span === 2 && 'sm:col-span-2', f.span === 3 && 'sm:col-span-3', f.type === 'bool' && 'flex items-center gap-2 pt-5')}>
              {f.type !== 'bool' ? <span className="text-xs font-medium text-[var(--muted-foreground)]">{f.label}</span> : null}
              {f.type === 'text' ? <Input value={v(f.key)} onChange={(e) => set(f.key, e.target.value)} /> : null}
              {f.type === 'number' ? <Input type="number" min={0} step="0.01" value={v(f.key)} onChange={(e) => set(f.key, e.target.value)} /> : null}
              {f.type === 'textarea' ? <Textarea rows={2} value={v(f.key)} onChange={(e) => set(f.key, e.target.value)} /> : null}
              {f.type === 'bool' ? (
                <>
                  <Switch checked={Boolean(edit?.[f.key])} onCheckedChange={(x) => set(f.key, x)} />
                  <span className="text-sm">{f.label}</span>
                </>
              ) : null}
              {f.type === 'select' ? (
                <Select value={v(f.key)} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(enums?.[f.enumKey!] ?? {}).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              ) : null}
              {f.type === 'parent' ? (
                <Select value={v(f.key)} onChange={(e) => set(f.key, e.target.value || null)}>
                  <option value="">— Cấp gốc —</option>
                  {(list.data ?? [])
                    .filter((c) => c.id !== edit?.id && !(edit?.path && String(c.path ?? '').startsWith(String(edit.path))))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {treeLabel(c)}
                      </option>
                    ))}
                </Select>
              ) : null}
              {f.type === 'dept' ? (
                <Select value={v(f.key)} onChange={(e) => set(f.key, e.target.value || null)}>
                  <option value="">—</option>
                  {(opts.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              {f.type === 'roles' ? (
                <div className="flex flex-wrap gap-3">
                  {Object.entries(meta.data?.supplierRoles ?? {}).map(([k, l]) => {
                    const cur = (edit?.roles as string[]) ?? [];
                    return (
                      <label key={k} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" className="accent-teal-600" checked={cur.includes(k)} onChange={() => set('roles', cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])} />
                        {l}
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {f.hint ? <span className="block text-[10.5px] text-[var(--muted-foreground)]">{f.hint}</span> : null}
            </label>
          ))}
          <label className="space-y-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Thứ tự</span>
            <Input type="number" value={v('sortOrder')} onChange={(e) => set('sortOrder', e.target.value)} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Ghi chú</span>
            <Input value={v('note')} onChange={(e) => set('note', e.target.value)} />
          </label>
        </div>
      </Dialog>
      <ConfirmDialog open={!!del} title={`Xoá "${del?.name}"?`} message="Mục chưa được dùng ở tài sản nào sẽ bị xoá hẳn." confirmText="Xoá" loading={remove.isPending} onConfirm={() => del && remove.mutate(del.id)} onClose={() => setDel(null)} />
    </div>
  );
}
