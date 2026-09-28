'use client';

/** Thiết kế / xem một báo cáo tuỳ biến theo id */
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/card';
import { studioApi } from '@/lib/studio';
import { StudioPageFrame, useStudioMeta } from '@/components/studio/studio-page';

export default function CustomReportByIdPage() {
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
    queryKey: ['studio', 'pages', 'REPORT'],
    queryFn: () => studioApi.pages('REPORT'),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={page.data?.name ?? 'Báo cáo tuỳ biến'}
        description={page.data?.description || 'Báo cáo tuỳ biến'}
        breadcrumb={<a href="/bao-cao/tuy-bien" className="hover:underline">Báo cáo tuỳ biến</a>}
      />
      {page.isLoading || meta.isLoading ? (
        <Skeleton className="h-72" />
      ) : page.isError || !page.data ? (
        <div className="rounded-[var(--radius-card)] border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          Không tìm thấy báo cáo hoặc bạn không có quyền xem.
        </div>
      ) : (
        <StudioPageFrame
          page={page.data}
          pages={pages.data ?? [page.data]}
          sources={meta.data?.sources ?? []}
          vocabulary={meta.data?.vocabulary ?? { aggs: {}, filterOps: {}, datePresets: {}, buckets: {} } as never}
          onNavigate={(pid) => {
            if (pid !== id) router.push(`/bao-cao/tuy-bien/${pid}`);
          }}
        />
      )}
    </div>
  );
}
