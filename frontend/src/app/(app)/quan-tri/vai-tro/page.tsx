'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Crown,
  KeyRound,
  Plus,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, normalizeVN } from '@/lib/utils';

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

interface Role {
  id: number;
  code: string;
  name: string;
  description?: string;
  dataScope: 'OWN' | 'DEPT' | 'ALL';
  priority: number;
  color?: string;
  isSystem: boolean;
  active: boolean;
}

interface Permission {
  id: number;
  code: string;
  module: string;
  action: string;
  name: string;
  description?: string;
}

interface Matrix {
  roles: Role[];
  permissions: Permission[];
  granted: Record<string, string[]>;
}

interface RoleMember {
  id: number;
  username: string;
  fullName: string;
  title?: string;
}

interface RoleDetail extends Role {
  members: RoleMember[];
}

/** Nhãn tiếng Việt cho nhóm quyền — giúp read ma trận phân quyền nhanh, không bị rối mã kỹ thuật. */
const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Tổng quan',
  department: 'Khoa — phòng ban',
  'hsba.request': 'HSBA — đề xuất sửa',
  'hsba.workflow': 'HSBA — luồng ký duyệt',
  'report.view': 'Báo cáo — xem',
  'report.entry': 'Báo cáo — nhập liệu',
  'report.snapshot': 'Báo cáo — chốt kỳ',
  'report.summary': 'Báo cáo — tổng hợp',
  'report.template': 'Báo cáo — mẫu biểu',
  'report.export': 'Báo cáo — xuất dữ liệu',
  asset: 'Tài sản',
  'asset.catalog': 'Tài sản — danh mục',
  'asset.transaction': 'Tài sản — phiếu biến động',
  'asset.depreciation': 'Tài sản — hao mòn / khấu hao',
  'asset.inventory': 'Tài sản — kiểm kê',
  'asset.report': 'Tài sản — báo cáo',
  'asset.label': 'Tài sản — in tem nhãn',
  'print.template': 'In ấn — mẫu in',
  'print.render': 'In ấn — in/sử dụng mẫu',
  'studio.report': 'Studio — báo cáo động',
  'studio.dashboard': 'Studio — dashboard động',
  user: 'Ngườii dùng',
  role: 'Vai trò & phân quyền',
  'audit.log': 'Nhật ký hệ thống',
  setting: 'Cấu hình hệ thống',
  backup: 'Sao lưu — phục hồi',
  job: 'Tác vụ định kỳ',
  utility: 'Tiện ích',
  file: 'Tệp đính kèm',
  data: 'Dữ liệu — nhập/xuất',
};

/** Quyền nhạy cảm: cần cân nhắc kỹ khi gán — hiển thị cảnh báo đỏ. */
const SENSITIVE_PREFIXES = ['user.', 'role.', 'setting.', 'backup.', 'audit.'];

/** Màu preset để gắn nhận diện vai trò trên giao diện. */
const ROLE_COLORS = [
  '#DC2626', '#EA580C', '#D97706', '#65A30D', '#059669', '#0D9488',
  '#0891B2', '#2563EB', '#4F46E5', '#7C3AED', '#C026D3', '#DB2777',
  '#475569', '#111827',
];

const SCOPE_LABEL: Record<string, string> = {
  ALL: 'Toàn viện',
  DEPT: 'Theo khoa',
  OWN: 'Cá nhân',
};

const isSensitive = (code: string): boolean => SENSITIVE_PREFIXES.some((p) => code.startsWith(p));

function RoleDot({ color }: { color?: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full ring-2 ring-[var(--background)]"
      style={{ background: color || '#94A3B8' }}
      title={color}
    />
  );
}

/** Vai trò & ma trận phân quyền chi tiết theo từng chức năng. */
export default function RolesPage() {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [duplicating, setDuplicating] = useState<Role | null>(null);
  const [newCode, setNewCode] = useState('');
  const [showMembers, setShowMembers] = useState(false);

  const { data: matrix, isLoading } = useQuery({
    queryKey: ['roles-matrix'],
    queryFn: () => apiFetch<Matrix>('/roles/matrix'),
  });

  const roles = matrix?.roles ?? [];
  const selected = roles.find((r) => r.id === selectedId) ?? null;
  const isSuper = selected?.code === SUPER_ADMIN_ROLE;
  const roleDetail = useQuery({
    queryKey: ['roles-detail', selectedId],
    enabled: !!selectedId,
    queryFn: () => apiFetch<RoleDetail>(`/roles/${selectedId}`),
  });

  useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles[0].id);
  }, [roles, selectedId]);

  useEffect(() => {
    if (selected) setChecked(new Set(matrix?.granted[selected.code] ?? []));
  }, [selected, matrix]);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    const kw = normalizeVN(keyword.trim());
    for (const p of matrix?.permissions ?? []) {
      if (kw && !normalizeVN(`${p.name} ${p.code} ${p.module}`).includes(kw)) continue;
      const list = map.get(p.module) ?? [];
      list.push(p);
      map.set(p.module, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [matrix, keyword]);

  /** Quyền nhạy cảm mới được tick so với dữ liệu đã lưu — cảnh báo trước khi lưu. */
  const newlyGrantedSensitive = useMemo(() => {
    if (!selected) return [];
    const saved = new Set(matrix?.granted[selected.code] ?? []);
    return [...checked].filter((c) => isSensitive(c) && !saved.has(c));
  }, [checked, matrix, selected]);

  const savePermissions = useMutation({
    mutationFn: (payload: { id: number; codes: string[] }) =>
      apiFetch(`/roles/${payload.id}/permissions`, { method: 'PUT', body: { permissionCodes: payload.codes } }),
    onSuccess: async () => {
      toast.success('Đã lưu phân quyền');
      await queryClient.invalidateQueries({ queryKey: ['roles-matrix'] });
      await queryClient.invalidateQueries({ queryKey: ['roles-detail'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const saveRole = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing && editing !== 'new'
        ? apiFetch(`/roles/${(editing as Role).id}`, { method: 'PUT', body: payload })
        : apiFetch('/roles', { method: 'POST', body: payload }),
    onSuccess: async () => {
      toast.success('Đã lưu vai trò');
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['roles-matrix'] });
      await queryClient.invalidateQueries({ queryKey: ['roles-detail'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const removeRole = useMutation({
    mutationFn: (id: number) => apiFetch(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Đã xoá vai trò');
      setDeleting(null);
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['roles-matrix'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const duplicateRole = useMutation({
    mutationFn: (payload: { id: number; code: string }) =>
      apiFetch(`/roles/${payload.id}/duplicate`, { method: 'POST', body: { code: payload.code } }),
    onSuccess: async () => {
      toast.success('Đã nhân bản vai trò');
      setDuplicating(null);
      setNewCode('');
      await queryClient.invalidateQueries({ queryKey: ['roles-matrix'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const openRoleForm = (role: Role | 'new'): void => {
    setEditing(role);
    setForm(
      role === 'new'
        ? { code: '', name: '', description: '', dataScope: 'DEPT', priority: 50, color: ROLE_COLORS[10] }
        : { ...role },
    );
  };

  const toggleAll = (list: Permission[], value: boolean): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const p of list) {
        if (value) next.add(p.code);
        else next.delete(p.code);
      }
      return next;
    });
  };

  const editingIsSuper = editing !== 'new' && (form.code === SUPER_ADMIN_ROLE);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vai trò & phân quyền"
        description="Mỗi vai trò gồm tập quyền chi tiết theo chức năng và phạm vi dữ liệu được xem"
        actions={
          can('role.create') ? (
            <Button onClick={() => openRoleForm('new')}>
              <Plus /> Thêm vai trò
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card className="max-h-[75vh] overflow-y-auto">
            <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {roles.length} vai trò · theo thứ tự ưu tiên
            </div>
            <div className="divide-y">
              {roles.map((role) => {
                const count = (matrix?.granted[role.code] ?? []).length;
                const isSup = role.code === SUPER_ADMIN_ROLE;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedId(role.id)}
                    className={cn(
                      'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                      selectedId === role.id ? 'bg-[var(--accent)]' : 'hover:bg-[var(--muted)]',
                    )}
                  >
                    <RoleDot color={role.color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{role.name}</span>
                        {isSup ? <Crown className="size-3.5 shrink-0 text-amber-500" /> : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                        <span className="font-mono">{role.code}</span>
                        <span>· {SCOPE_LABEL[role.dataScope]}</span>
                      </div>
                    </div>
                    <Badge tone={isSup ? 'danger' : 'muted'}>{isSup ? 'Toàn quyền' : `${count} quyền`}</Badge>
                  </button>
                );
              })}
            </div>
          </Card>

          {selected ? (
            <Card className="flex max-h-[75vh] flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <RoleDot color={selected.color} />
                    <ShieldCheck className="size-4 text-[var(--primary)]" />
                    {selected.name}
                    {roleDetail.data?.isSystem ? <Badge tone="muted">Hệ thống</Badge> : null}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    Mã <span className="font-mono">{selected.code}</span> · phạm vi {SCOPE_LABEL[selected.dataScope]} ·{' '}
                    {isSuper ? (
                      <>toàn bộ quyền trong hệ thống</>
                    ) : (
                      <>đang có {checked.size}/{(matrix?.permissions ?? []).length} quyền</>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Tìm quyền…"
                      className="h-8.5 w-44 pl-8 text-sm"
                    />
                  </div>
                  {can('role.create') ? (
                    <Button variant="outline" size="sm" onClick={() => setDuplicating(selected)}>
                      <Copy /> Nhân bản
                    </Button>
                  ) : null}
                  {can('role.update') ? (
                    <Button variant="outline" size="sm" onClick={() => openRoleForm(selected)}>
                      Sửa vai trò
                    </Button>
                  ) : null}
                  {can('role.delete') && !(roleDetail.data?.isSystem ?? false) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[var(--danger)]"
                      onClick={() => setDeleting(selected)}
                    >
                      <Trash2 /> Xoá
                    </Button>
                  ) : null}
                  {!isSuper && can('role.update') ? (
                    <Button
                      size="sm"
                      loading={savePermissions.isPending}
                      onClick={() => savePermissions.mutate({ id: selected.id, codes: [...checked] })}
                    >
                      <Save /> Lưu phân quyền
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* Người đang giữ vai trò — xem nhanh để không xoá/sửa nhầm vai trò đang dùng */}
              <div className="border-b px-4 py-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  onClick={() => setShowMembers((s) => !s)}
                >
                  <Users className="size-3.5" />
                  <b>{roleDetail.data?.members?.length ?? '…'}</b>&nbsp;người đang giữ vai trò này
                  <span className="ml-auto">{showMembers ? '▲ thu gọn' : '▼ xem danh sách'}</span>
                </button>
                {showMembers ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(roleDetail.data?.members ?? []).length === 0 ? (
                      <span className="text-xs text-[var(--muted-foreground)]">Chưa có ai — có thể xoá nếu không dùng.</span>
                    ) : (
                      (roleDetail.data?.members ?? []).map((m) => (
                        <Badge key={m.id} tone="muted">
                          {m.fullName}
                          {m.title ? <span className="opacity-70"> · {m.title}</span> : null}
                        </Badge>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              {isSuper ? (
                <div className="flex items-start gap-3 border-b bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                  <Crown className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <b>Quản trị tối cao</b> — vai trò này luôn có mọi quyền trong hệ thống (kể cả quyền mới được thêm về
                    sau). Không thể chỉnh sửa tập quyền; chỉ Quản trị tối cao khác mới được gán vai trò này cho người
                    dùng.
                  </div>
                </div>
              ) : null}

              {!isSuper && newlyGrantedSensitive.length > 0 ? (
                <div className="flex items-start gap-3 border-b bg-red-50 px-4 py-2.5 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <div>
                    Sắp cấp <b>{newlyGrantedSensitive.length} quyền nhạy cảm</b> (quản trị người dùng/vai trò/cấu
                    hình/sao lưu/nhật ký). Hãy chắc chắn vai trò này thực sự cần — nhấn Lưu để xác nhận.
                  </div>
                </div>
              ) : null}

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {grouped.length === 0 ? (
                  <EmptyState title="Không tìm thấy quyền phù hợp" />
                ) : (
                  grouped.map(([module, perms]) => {
                    const allChecked = perms.every((p) => checked.has(p.code));
                    return (
                      <div key={module} className="overflow-hidden rounded-xl border">
                        <div className="flex items-center justify-between gap-2 border-b bg-[var(--muted)]/50 px-3 py-2">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold">{MODULE_LABEL[module] ?? module}</span>
                            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{module}</span>
                          </div>
                          <label
                            className={cn(
                              'flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]',
                              isSuper && 'pointer-events-none opacity-60',
                            )}
                          >
                            <input
                              type="checkbox"
                              disabled={isSuper}
                              checked={isSuper ? true : allChecked}
                              onChange={(e) => toggleAll(perms, e.target.checked)}
                            />
                            Chọn cả nhóm
                          </label>
                        </div>
                        <div className="grid gap-1 p-2 sm:grid-cols-2">
                          {perms.map((p) => {
                            const sensitive = isSensitive(p.code);
                            return (
                              <label
                                key={p.code}
                                className={cn(
                                  'flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--muted)]',
                                  isSuper ? 'cursor-default' : sensitive ? 'cursor-pointer bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20 dark:hover:bg-red-950/40' : 'cursor-pointer',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  disabled={isSuper}
                                  checked={isSuper ? true : checked.has(p.code)}
                                  onChange={(e) =>
                                    setChecked((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(p.code);
                                      else next.delete(p.code);
                                      return next;
                                    })
                                  }
                                />
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1.5">
                                    <span className="block truncate">{p.name}</span>
                                    {sensitive ? <Badge tone="danger">Nhạy cảm</Badge> : null}
                                  </span>
                                  <span className="block font-mono text-[10px] text-[var(--muted-foreground)]">
                                    {p.code}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          ) : (
            <Card className="flex items-center justify-center p-10 text-sm text-[var(--muted-foreground)]">
              Chọn một vai trò để xem và chỉnh tập quyền.
            </Card>
          )}
        </div>
      )}

      {/* Thêm / sửa vai trò */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Thêm vai trò' : `Sửa vai trò: ${String(form.name ?? '')}`}
        description={
          editingIsSuper
            ? 'Quản trị tối cao là vai trò bất biến — chỉ đổi được mô tả và màu nhận diện.'
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Huỷ
            </Button>
            <Button form="role-form" type="submit" loading={saveRole.isPending}>
              <KeyRound /> Lưu
            </Button>
          </>
        }
      >
        <form
          id="role-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (editingIsSuper) {
              saveRole.mutate({ description: form.description, color: form.color });
              return;
            }
            saveRole.mutate(form);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="role-code">Mã vai trò *</Label>
            <Input
              id="role-code"
              value={String(form.code ?? '')}
              onChange={(e) => setForm((s) => ({ ...s, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
              required
              disabled={editing !== 'new'}
              placeholder="TRUONG_KHOA"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Tên vai trò *</Label>
            <Input
              id="role-name"
              value={String(form.name ?? '')}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              required
              disabled={editingIsSuper}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-scope">Phạm vi dữ liệu</Label>
            <Select
              id="role-scope"
              value={String(form.dataScope ?? 'DEPT')}
              onChange={(e) => setForm((s) => ({ ...s, dataScope: e.target.value }))}
              disabled={editingIsSuper}
            >
              <option value="OWN">Chỉ dữ liệu do mình tạo</option>
              <option value="DEPT">Theo khoa được gán</option>
              <option value="ALL">Toàn viện</option>
            </Select>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Một người có nhiều vai trò sẽ hưởng phạm vi RỘNG NHẤT trong các vai trò đó.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-priority">Thứ tự ưu tiên (số nhỏ → vai trò quan trọng hơn, hiển thị trước)</Label>
            <Input
              id="role-priority"
              type="number"
              min={0}
              max={1000}
              value={Number(form.priority ?? 50)}
              onChange={(e) => setForm((s) => ({ ...s, priority: Number(e.target.value) || 0 }))}
              disabled={editingIsSuper}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Màu nhận diện</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {ROLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((s) => ({ ...s, color: c }))}
                  className={cn(
                    'size-6 rounded-full ring-offset-2 transition-transform hover:scale-110',
                    form.color === c ? 'ring-2 ring-[var(--foreground)] ring-offset-[var(--background)]' : '',
                  )}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-desc">Mô tả</Label>
            <Input
              id="role-desc"
              value={String(form.description ?? '')}
              onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
            />
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!duplicating}
        onClose={() => setDuplicating(null)}
        title={`Nhân bản vai trò: ${duplicating?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDuplicating(null)}>
              Huỷ
            </Button>
            <Button
              loading={duplicateRole.isPending}
              disabled={!newCode.trim()}
              onClick={() => duplicating && duplicateRole.mutate({ id: duplicating.id, code: newCode.trim().toUpperCase() })}
            >
              Nhân bản
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="dup-code">Mã vai trò mới *</Label>
          <Input id="dup-code" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="TRUONG_KHOA_2" />
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Toàn bộ quyền của vai trò gốc sẽ được sao chép sang vai trò mới (kèm phạm vi dữ liệu, màu, độ ưu tiên).
          </p>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        title="Xoá vai trò"
        message={
          <>
            Xoá vai trò <b>{deleting?.name}</b>? Chỉ xoá được khi chưa có người dùng nào được gán.
          </>
        }
        confirmText="Xoá"
        loading={removeRole.isPending}
        onConfirm={() => deleting && removeRole.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
