'use client';

/**
 * Studio — dialog "bản ghi gốc" (drill-down).
 * Mở khi người dùng bấm vào dòng bảng / thẻ KPI / phân đoạn biểu đồ:
 * gọi query engine ở chế độ `records` với cùng bộ lọc của ô + bộ lọc
 * suy ra từ điểm được bấm (kích thước nhóm → điều kiện bằng / khoảng ngày).
 */
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { downloadFile } from '@/lib/api';
import { studioApi, type StudioDataSpec } from '@/lib/studio';
import { DRILL_PAGE_SIZE } from './drilldown-shared';
import { formatDate, formatDateTime, formatNumber } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/card';



/* ------------------------------------------------------------- dialog */

export function DrilldownDialog({
  open,
  onClose,
  title,
  description,
  spec,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  spec: StudioDataSpec | null;
}) {
  const [offset, setOffset] = useState(0);
  const querySpec: StudioDataSpec | null = spec ? { ...spec, mode: 'records', limit: DRILL_PAGE_SIZE, offset } : null;
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['studio-drilldown', open ? JSON.stringify(querySpec) : '-'],
    queryFn: () => studioApi.run(querySpec as StudioDataSpec),
    enabled: open && !!querySpec,
    staleTime: 15_000,
    retry: 1,
  });

  const total = data?.meta.total ?? 0;
  const page = Math.floor(offset / DRILL_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / DRILL_PAGE_SIZE));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          {title}
          {isFetching ? <Loader2 className="size-4 animate-spin text-[var(--muted-foreground)]" /> : null}
        </span>
      }
      description={description}
      footer={
        <>
          <div className="mr-auto text-xs text-[var(--muted-foreground)]">
            {total ? `${formatNumber(total)} bản ghi · trang ${page}/${pages}` : 'Không có bản ghi khớp'}
          </div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setOffset(Math.max(0, offset - DRILL_PAGE_SIZE))}
            className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setOffset(offset + DRILL_PAGE_SIZE)}
            className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40"
          >
            <ChevronRight className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-[var(--accent)]"
            onClick={async () => {
              if (!spec) return;
              await downloadFile(
                '/studio/query/export',
                `${title || 'ban-ghi'}.xlsx`,
                { method: 'POST', body: JSON.stringify({ ...spec, mode: 'records', title }) },
              );
            }}
          >
            <Download className="size-3.5" /> Excel
          </button>
        </>
      }
    >
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <div className="py-10 text-center text-sm text-rose-600">{(error as Error).message}</div>
      ) : !data?.columns.length ? (
        <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">Không có dữ liệu</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                {data.columns.map((c) => (
                  <th key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${c.type === 'number' ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-[var(--accent)]">
                  {data.columns.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                      {row[c.key] === null || row[c.key] === undefined || row[c.key] === ''
                        ? '—'
                        : c.type === 'number'
                          ? formatNumber(row[c.key])
                          : c.type === 'date'
                            ? formatDate(String(row[c.key]))
                            : c.type === 'datetime'
                              ? formatDateTime(String(row[c.key]))
                              : String(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
