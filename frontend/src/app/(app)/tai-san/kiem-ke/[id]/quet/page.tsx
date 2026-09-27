'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { InventoryScanPane } from '@/components/assets/inventory-scan';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import type { InventoryDetail } from '@/app/(app)/tai-san/kiem-ke/[id]/page';

/** Trang quét kiểm kê tối ưu cho điện thoại (đường dẫn ngắn để lưu trên màn hình chính) */
export default function InventoryScanPage() {
  const id = Number(useParams().id);
  const detail = useQuery({
    queryKey: ['asset-inventory', id],
    queryFn: () => apiFetch<InventoryDetail>(`/asset-inventories/${id}`),
    refetchInterval: 20_000,
    retry: false,
  });
  if (detail.isLoading) return <Skeleton className="h-96" />;
  const d = detail.data;
  if (!d) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-amber-600" />
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">Không mở được đợt kiểm kê (không tồn tại hoặc bạn không tham gia).</p>
        <Link href="/tai-san/kiem-ke" className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:underline">← Quay lại danh sách đợt</Link>
      </div>
    );
  }
  if (!d.can.scan) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Đợt kiểm kê đang ở trạng thái “{d.statusLabel}” — không còn nhận quét bằng trang này.</p>
        <Link href={`/tai-san/kiem-ke/${id}`} className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:underline">→ Xem kết quả kiểm kê</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        breadcrumb={
          <Link href={`/tai-san/kiem-ke/${id}`} className="inline-flex items-center gap-1">
            <ArrowLeft className="size-3.5" /> {d.code} — {d.name}
          </Link>
        }
        title="Quét kiểm kê"
        description={d.scopeText}
      />
      <InventoryScanPane id={id} detail={d} />
    </div>
  );
}
