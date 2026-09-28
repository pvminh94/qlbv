'use client';

/**
 * Studio — dialog "Ấn bản định kỳ":
 *  - Mục ĐĂNG KÝ: nhận Excel của trang hiện tại theo lịch (ngày/tuần/tháng + giờ).
 *    Có nút chạy thử ngay, bật/tắt, xoá.
 *  - Mục ẤN BẢN ĐÃ PHÁT HÀNH: các file Excel đã sinh cho tôi — tải về.
 * File Excel được dựng bởi tác vụ nền với đúng quyền/phạm vi của người đăng ký.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Download, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadFile } from '@/lib/api';
import {
  studioApi,
  SUB_FREQUENCY_LABELS,
  type StudioPage,
  type StudioSubFrequency,
} from '@/lib/studio';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';

function fmtSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function StatusBadge({ status, error }: { status: string; error?: string }) {
  if (status === 'SUCCESS') return <Badge tone="success">Thành công</Badge>;
  if (status === 'FAILED') return <Badge tone="danger" >Lỗi{error ? `: ${error.slice(0, 30)}` : ''}</Badge>;
  return <Badge tone="muted">Chờ chạy</Badge>;
}

export function SubscriptionsDialog({
  open,
  onClose,
  page,
}: {
  open: boolean;
  onClose: () => void;
  page: StudioPage;
}) {
  const queryClient = useQueryClient();
  const hourNow = new Date().getHours();

  const subs = useQuery({
    queryKey: ['studio-subs'],
    queryFn: studioApi.subscriptions,
    enabled: open,
  });
  const files = useQuery({
    queryKey: ['studio-sub-files'],
    queryFn: studioApi.subscriptionFiles,
    enabled: open,
  });

  const mine = (subs.data ?? []).filter((s) => s.pageId === page.id);
  const others = (subs.data ?? []).filter((s) => s.pageId !== page.id);

  const [label, setLabel] = useState('');
  const [frequency, setFrequency] = useState<StudioSubFrequency>('DAILY');
  const [hourOfDay, setHourOfDay] = useState(6);
  useEffect(() => {
    if (open) { setLabel(''); setFrequency('DAILY'); setHourOfDay(6); }
  }, [open]);

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['studio-subs'] });
    await queryClient.invalidateQueries({ queryKey: ['studio-sub-files'] });
  };

  const create = useMutation({
    mutationFn: () => studioApi.createSubscription({ pageId: page.id, label, frequency, hourOfDay }),
    onSuccess: refreshAll,
  });
  const toggle = useMutation({
    mutationFn: (args: { id: number; active: boolean }) => studioApi.updateSubscription(args.id, { active: args.active }),
    onSuccess: refreshAll,
  });
  const run = useMutation({
    mutationFn: (id: number) => studioApi.runSubscription(id),
    onSuccess: refreshAll,
  });
  const remove = useMutation({
    mutationFn: (id: number) => studioApi.removeSubscription(id),
    onSuccess: refreshAll,
  });
  const error =
    (create.error as Error | null)?.message ||
    (run.error as Error | null)?.message ||
    (remove.error as Error | null)?.message ||
    (toggle.error as Error | null)?.message ||
    '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <BellRing className="size-4 text-[var(--primary)]" /> Ấn bản định kỳ — {page.name}
        </span>
      }
      description="Nhận file Excel của trang này tự động theo lịch; số liệu luôn theo đúng quyền/phạm vi của bạn"
    >
      <div className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        ) : null}

        {/* Đăng ký mới cho trang hiện tại */}
        <section className="rounded-xl border p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Đăng ký nhận cho trang này
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <Label>Tên gợi nhớ</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Báo cáo đầu ngày" maxLength={120} />
            </div>
            <div>
              <Label>Tần suất</Label>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value as StudioSubFrequency)}>
                {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => (
                  <option key={f} value={f}>{SUB_FREQUENCY_LABELS[f]}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Giờ (giờ máy chủ)</Label>
              <Select value={String(hourOfDay)} onChange={(e) => setHourOfDay(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00{h === hourNow ? ' (hiện tại)' : ''}</option>
                ))}
              </Select>
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Đăng ký
            </Button>
          </div>
        </section>

        {/* Đăng ký của tôi */}
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Đăng ký của tôi {mine.length ? `(${mine.length} cho trang này)` : ''}
          </div>
          {subs.isLoading ? (
            <div className="text-sm text-[var(--muted-foreground)]">Đang tải…</div>
          ) : !(subs.data ?? []).length ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">
              Chưa có đăng ký nào — tạo ở khung trên
            </div>
          ) : (
            <div className="divide-y rounded-xl border">
              {[...mine, ...others].map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {s.label || s.pageName}
                      {s.pageId !== page.id ? <span className="ml-1 text-xs text-[var(--muted-foreground)]">(trang: {s.pageName})</span> : null}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {SUB_FREQUENCY_LABELS[s.frequency]} · {String(s.hourOfDay).padStart(2, '0')}:00 · kế tiếp {s.nextRunAt ? formatDateTime(s.nextRunAt) : '—'}
                    </div>
                  </div>
                  <StatusBadge status={s.lastStatus} error={s.lastError} />
                  <Button
                    variant="outline"
                    title="Phát hành thử ngay (không đổi lịch định kỳ)"
                    disabled={run.isPending}
                    onClick={() => run.mutate(s.id)}
                  >
                    <Play className="size-3.5" />
                  </Button>
                  <Button
                    variant={s.active ? 'outline' : 'ghost'}
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: s.id, active: !s.active })}
                  >
                    {s.active ? 'Tắt' : 'Bật'}
                  </Button>
                  <Button
                    variant="danger"
                    title="Xoá đăng ký"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm('Xoá đăng ký ấn bản này?')) remove.mutate(s.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Ấn bản đã phát hành */}
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Ấn bản đã phát hành cho tôi
          </div>
          {files.isLoading ? (
            <div className="text-sm text-[var(--muted-foreground)]">Đang tải…</div>
          ) : !(files.data ?? []).length ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">
              Chưa có ấn bản nào — bấm nút ▶ ở một đăng ký để phát hành thử
            </div>
          ) : (
            <div className="max-h-56 divide-y overflow-y-auto rounded-xl border">
              {(files.data ?? []).map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{f.fileName}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {f.pageName} · {formatDateTime(f.createdAt)} · {fmtSize(f.sizeBytes)}
                      {f.trigger === 'manual' ? ' · chạy thử' : ''}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void downloadFile(`/studio/subscriptions/files/${f.id}/download`, f.fileName)}
                    title="Tải về Excel"
                  >
                    <Download className="size-3.5" /> Tải
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            Ấn bản được giữ theo thờI hạn lưu trữ kết xuất của hệ thống. Tổng dung lượng hiển thị: {formatNumber((files.data ?? []).reduce((a, f) => a + f.sizeBytes, 0))} bytes.
          </div>
        </section>
      </div>
    </Dialog>
  );
}
