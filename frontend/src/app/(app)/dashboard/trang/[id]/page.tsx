'use client';

/** Xem/chỉnh sửa một trang bảng điều khiển theo id */
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/card';
import { studioApi } from '@/lib/studio';
import { StudioPageFrame, useStudioMeta } from '@/components/studio/studio-page';

export default function DashboardByIdPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);

  const meta = useStudioMeta();
  const page = useQuery({
    queryKey: ['studio', 'page', id],
    queryFn: () => studioApi.getPage(id),
    enabled: Number.isFinite(id),
    retry: false,
  });
  const pages = useQuery({
    queryKey: ['studio', 'pages', 'DASHBOARD'],
    queryFn: () => studioApi.pages('DASHBOARD'),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={page.data?.name ?? 'Bảng điều khiển'}
        description={page.data?.description || 'Bảng điều khiển tuỳ biến'}
        breadcrumb={<a href="/dashboard" className="hover:underline">Bảng điều khiển</a>}
      />
      {page.isLoading || meta.isLoading ? (
        <Skeleton className="h-72" />
      ) : page.isError || !page.data ? (
        <div className="rounded-[var(--radius-card)] border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          Không tìm thấy trang hoặc bạn không có quyền xem.
        </div>
      ) : (
        <StudioPageFrame
          page={page.data}
          pages={pages.data ?? [page.data]}
          sources={meta.data?.sources ?? []}
          vocabulary={meta.data?.vocabulary ?? { aggs: {}, filterOps: {}, datePresets: {}, buckets: {} } as never}
          onNavigate={(pid) => {
            if (pid === id) return;
            router.push(`/dashboard/trang/${pid}`);
          }}
        />
      )}
    </div>
  );
}
