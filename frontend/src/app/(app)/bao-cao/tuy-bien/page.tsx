'use client';

/** Báo cáo tuỳ biến — danh sách trang REPORT (củA tôi + vai trò + hệ thống) */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Copy, Plus, Star, StarOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { studioApi, type StudioPage } from '@/lib/studio';
import { formatDateTime } from '@/lib/utils';

export default function CustomReportsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Mọi ngườI có quyền xem đều tạo được báo cáo cá nhân; backend chỉ yêu cầu manage cho trang dùng chung
  const canManage = useAuth((s) => s.can)('studio.report.view');
  const user = useAuth((s) => s.user);
  const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');

  const pages = useQuery({
    queryKey: ['studio', 'pages', 'REPORT'],
    queryFn: () => studioApi.pages('REPORT'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['studio'] });

  const create = async () => {
    const name = window.prompt('Tên báo cáo mới:', 'Báo cáo của tôi');
    if (!name) return;
    const created = await studioApi.createPage({
      name: name.trim().slice(0, 120) || 'Báo cáo của tôi',
      kind: 'REPORT',
      layout: { widgets: [] },
    });
    router.push(`/bao-cao/tuy-bien/${created.id}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Báo cáo tuỳ biến"
        description="Tự thiết kế báo cáo từ các nguồn dữ liệu được phép: chọn chỉ số, nhóm, lọc, biểu đồ và bảng — xuất Excel ngay trên từng ô"
        breadcrumb={<Link href="/bao-cao" className="hover:underline">Báo cáo</Link>}
        actions={
          canManage ? (
            <Button onClick={() => void create()}>
              <Plus className="size-4" /> Tạo báo cáo
            </Button>
          ) : undefined
        }
      />

      {pages.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !pages.data?.length ? (
        <Card>
          <EmptyState
            title="Chưa có báo cáo tuỳ biến nào"
            description="Bấm 'Tạo báo cáo' để bắt đầu thiết kế báo cáo riêng của bạn"
            action={canManage ? <Button onClick={() => void create()}><Plus className="size-4" /> Tạo báo cáo</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pages.data.map((p: StudioPage) => {
            const canEdit = isAdmin || (p.scope === 'PERSONAL' && p.ownerId === user?.id);
            return (
              <Card key={p.id} className="flex flex-col">
                <div className="flex-1 space-y-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/bao-cao/tuy-bien/${p.id}`} className="block truncate font-semibold hover:text-[var(--primary)]">
                        {p.name}
                      </Link>
                      <div className="line-clamp-2 text-xs text-[var(--muted-foreground)]">
                        {p.description || '—'}
                      </div>
                    </div>
                    <BarChart3 className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    {p.scope === 'SYSTEM' ? <Badge tone="brand">Hệ thống</Badge> : null}
                    {p.scope === 'ROLE' ? <Badge tone="muted">{p.roleCode}</Badge> : null}
                    {p.scope === 'PERSONAL' ? <Badge tone="success">CủA tôi</Badge> : null}
                    {p.isDefault ? <Badge tone="warning">Mặc định</Badge> : null}
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    {p.layout.widgets.length} ô · cập nhật {formatDateTime(p.updatedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1 border-t px-2 py-1.5">
                  <Button size="sm" variant="ghost" onClick={() => router.push(`/bao-cao/tuy-bien/${p.id}`)}>
                    Mở
                  </Button>
                  <div className="flex-1" />
                  {canEdit ? (
                    <button
                      type="button"
                      title={p.isDefault ? 'Bỏ mặc định' : 'Đặt mặc định'}
                      className="rounded p-1.5 hover:bg-[var(--accent)]"
                      onClick={async () => { await studioApi.setDefault(p.id, !p.isDefault); await refresh(); }}
                    >
                      {p.isDefault ? <StarOff className="size-4" /> : <Star className="size-4" />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title="Nhân bản"
                    className="rounded p-1.5 hover:bg-[var(--accent)]"
                    onClick={async () => { const c = await studioApi.duplicatePage(p.id); await refresh(); router.push(`/bao-cao/tuy-bien/${c.id}`); }}
                  >
                    <Copy className="size-4" />
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      title="Xoá"
                      className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                      onClick={async () => {
                        if (!window.confirm(`Xoá báo cáo "${p.name}"?`)) return;
                        try { await studioApi.removePage(p.id); await refresh(); } catch (e) { alert(e instanceof Error ? e.message : 'Xoá thất bại'); }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
