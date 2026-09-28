'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, StatCard } from '@/components/shared/page-header';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Label, Select, Switch, Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { Department } from '@/types/api';

const KINDS = [
  { value: 'VIEN', label: 'Ban giám đốc / Viện' },
  { value: 'KHOI', label: 'Khối' },
  { value: 'KHOA', label: 'Khoa' },
  { value: 'PHONG', label: 'Phòng chức năng' },
  { value: 'TRUNG_TAM', label: 'Trung tâm' },
  { value: 'BAN', label: 'Ban' },
  { value: 'TO', label: 'Tổ / Nhóm' },
];

const emptyForm = (parentId: number | null, level: number): Record<string, unknown> => ({
  code: '',
  name: '',
  shortName: '',
  parentId,
  level,
  kind: level >= 3 ? 'KHOA' : 'KHOI',
  reportCode: '',
  phone: '',
  email: '',
  headName: '',
  note: '',
  sortOrder: 0,
  reportEnabled: true,
  active: true,
});

/**
 * Quản trị cây đơn vị: thêm khoa/phòng không giới hạn cấp,
 * bật/tắt nhập báo cáo cho từng khoa.
 */
export default function DepartmentsPage() {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Department | null>(null);
  const [creating, setCreating] = useState<{ parentId: number | null; level: number } | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(emptyForm(null, 1));
  const [deleting, setDeleting] = useState<Department | null>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['departments-tree'],
    queryFn: () => apiFetch<Department[]>('/departments/tree?includeInactive=true'),
  });

  const flat = useMemo(() => {
    const out: Department[] = [];
    const walk = (nodes: Department[] | undefined): void => {
      for (const n of nodes ?? []) {
        out.push(n);
        walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  useEffect(() => {
    if (expanded.size === 0 && flat.length) {
      setExpanded(new Set(flat.filter((d) => d.level <= 2).map((d) => d.id)));
    }
  }, [flat, expanded.size]);

  const stats = useMemo(
    () => ({
      total: flat.length,
      reportable: flat.filter((d) => d.reportEnabled).length,
      inactive: flat.filter((d) => !d.active).length,
    }),
    [flat],
  );

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['departments-tree'] });
    await queryClient.invalidateQueries({ queryKey: ['departments-options'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      selected
        ? apiFetch(`/departments/${selected.id}`, { method: 'PUT', body: payload })
        : apiFetch('/departments', { method: 'POST', body: payload }),
    onSuccess: async () => {
      toast.success(selected ? 'Đã cập nhật đơn vị' : 'Đã thêm đơn vị mới');
      setCreating(null);
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Đã xoá đơn vị');
      setDeleting(null);
      setSelected(null);
      await invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const openEdit = (dept: Department): void => {
    setSelected(dept);
    setCreating(null);
    setForm({ ...dept });
  };

  const openCreate = (parentId: number | null, level: number): void => {
    setSelected(null);
    setCreating({ parentId, level });
    setForm(emptyForm(parentId, level));
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const payload = { ...form };
    delete payload.children;
    delete payload.parentName;
    delete payload.userCount;
    delete payload.path;
    saveMutation.mutate(payload);
  };

  const renderNode = (node: Department, depth: number): React.ReactNode => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isOpen = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors',
            selected?.id === node.id ? 'bg-[var(--accent)] font-medium' : 'hover:bg-[var(--muted)]',
          )}
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)]"
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              })
            }
            aria-label={isOpen ? 'Thu gọn' : 'Mở rộng'}
          >
            {hasChildren ? isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : <span className="size-3.5" />}
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openEdit(node)}>
            <Building2 className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
            <span className="truncate">{node.name}</span>
            <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{node.code}</span>
            {node.reportEnabled ? <Badge tone="info">Báo cáo</Badge> : null}
            {!node.active ? <Badge tone="muted">Ngừng</Badge> : null}
          </button>
          {can('department.create') ? (
            <button
              type="button"
              title="Thêm đơn vị trực thuộc"
              className="rounded p-1 opacity-0 transition group-hover:opacity-100 hover:bg-[var(--card)]"
              onClick={() => openCreate(node.id, node.level + 1)}
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>
        {hasChildren && isOpen ? node.children?.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  const set = (key: string, value: unknown): void => setForm((s) => ({ ...s, [key]: value }));
  const editing = !!selected || !!creating;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Khoa phòng & cơ cấu tổ chức"
        description="Cây đơn vị nhiều cấp — dùng cho phân quyền theo khoa, báo cáo và luân chuyển hồ sơ"
        actions={
          can('department.create') ? (
            <Button onClick={() => openCreate(null, 1)}>
              <Plus /> Thêm đơn vị gốc
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Tổng số đơn vị" value={stats.total} icon={<FolderTree className="size-4" />} tone="primary" />
        <StatCard label="Đơn vị nhập báo cáo" value={stats.reportable} icon={<Building2 className="size-4" />} tone="success" />
        <StatCard label="Đang ngừng hoạt động" value={stats.inactive} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : flat.length === 0 ? (
            <EmptyState title="Chưa có đơn vị nào" description="Bấm “Thêm đơn vị gốc” để bắt đầu." />
          ) : (
            tree?.map((node) => renderNode(node, 0))
          )}
        </Card>

        {editing ? (
          <Card>
            <form onSubmit={submit} className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div>
                  <div className="text-base font-semibold">
                    {selected ? `Cập nhật: ${selected.name}` : 'Thêm đơn vị mới'}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    {creating?.parentId
                      ? `Trực thuộc: ${flat.find((d) => d.id === creating.parentId)?.name ?? ''}`
                      : 'Đơn vị gốc (cấp cao nhất)'}
                  </div>
                </div>
                {selected && can('department.delete') ? (
                  <Button type="button" variant="danger" size="sm" onClick={() => setDeleting(selected)}>
                    <Trash2 /> Xoá
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Mã đơn vị *</Label>
                  <Input id="code" value={String(form.code ?? '')} onChange={(e) => set('code', e.target.value)} required placeholder="KPK" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kind">Loại đơn vị</Label>
                  <Select id="kind" value={String(form.kind ?? '')} onChange={(e) => set('kind', e.target.value)}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="name">Tên đơn vị *</Label>
                  <Input id="name" value={String(form.name ?? '')} onChange={(e) => set('name', e.target.value)} required placeholder="Khoa Phẫu thuật - Gây mê hồi sức" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shortName">Tên viết tắt</Label>
                  <Input id="shortName" value={String(form.shortName ?? '')} onChange={(e) => set('shortName', e.target.value)} placeholder="K.PT-GMHS" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reportCode">Mã báo cáo</Label>
                  <Input id="reportCode" value={String(form.reportCode ?? '')} onChange={(e) => set('reportCode', e.target.value)} placeholder="B4 / B5" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="headName">Trưởng khoa / phụ trách</Label>
                  <Input id="headName" value={String(form.headName ?? '')} onChange={(e) => set('headName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parentId">Đơn vị cấp trên</Label>
                  <Select
                    id="parentId"
                    value={String(form.parentId ?? '')}
                    onChange={(e) => set('parentId', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— Không có (cấp gốc) —</option>
                    {flat
                      .filter((d) => d.id !== selected?.id && !d.path?.startsWith(`${selected?.path ?? ''}`) )
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {'— '.repeat(Math.max(0, d.level - 1))}
                          {d.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Điện thoại</Label>
                  <Input id="phone" value={String(form.phone ?? '')} onChange={(e) => set('phone', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Thư điện tử</Label>
                  <Input id="email" value={String(form.email ?? '')} onChange={(e) => set('email', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sortOrder">Thứ tự hiển thị</Label>
                  <Input id="sortOrder" type="number" value={String(form.sortOrder ?? 0)} onChange={(e) => set('sortOrder', Number(e.target.value))} />
                </div>
                <div className="flex items-center gap-6 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={Boolean(form.reportEnabled)} onCheckedChange={(v) => set('reportEnabled', v)} />
                    Khoa nhập báo cáo công tác
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={Boolean(form.active)} onCheckedChange={(v) => set('active', v)} />
                    Đang hoạt động
                  </label>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="note">Ghi chú</Label>
                  <Textarea id="note" value={String(form.note ?? '')} onChange={(e) => set('note', e.target.value)} rows={3} />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelected(null);
                    setCreating(null);
                  }}
                >
                  Đóng
                </Button>
                <Button type="submit" loading={saveMutation.isPending}>
                  <Save /> Lưu lại
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card className="flex items-center justify-center p-10 text-sm text-[var(--muted-foreground)]">
            Chọn một đơn vị ở cây bên trái để sửa, hoặc bấm dấu “+” để thêm đơn vị trực thuộc.
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Xoá đơn vị"
        message={
          <>
            Xoá <b>{deleting?.name}</b>? Chỉ xoá được khi đơn vị không còn đơn vị trực thuộc và không còn người dùng.
          </>
        }
        confirmText="Xoá"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
