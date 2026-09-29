'use client';

/**
 * Trung tâm thông báo — xem lại toàn bộ, lọc theo mô-đun / trạng thái đọc,
 * và tuỳ chỉnh "cảm nhận tức thời" (toast nổi, âm thanh, badge tab).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  CheckCircle2,
  TriangleAlert,
  XCircle,
  Trash2,
  Volume2,
  VolumeX,
  MonitorSmartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/card';
import {
  DEFAULT_PREFS,
  readNotifyPrefs,
  writeNotifyPrefs,
  type NotifyPrefs,
} from '@/components/notification-toast';
import { apiFetch } from '@/lib/api';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { cn, formatDateTime } from '@/lib/utils';

interface NotificationItem {
  id: number;
  title: string;
  body: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  link: string;
  module: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPage {
  items: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  unread: number;
  grandTotal: number;
}

const LEVEL_META = {
  INFO: { icon: Info, className: 'text-sky-500 bg-sky-500/10' },
  SUCCESS: { icon: CheckCircle2, className: 'text-emerald-500 bg-emerald-500/10' },
  WARNING: { icon: TriangleAlert, className: 'text-amber-500 bg-amber-500/10' },
  ERROR: { icon: XCircle, className: 'text-red-500 bg-red-500/10' },
} as const;

const READ_TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'unread', label: 'Chưa đọc' },
  { key: 'read', label: 'Đã đọc' },
] as const;

/** "5 phút trướớC" — qua 7 ngày thì trả ngày giờ đầy đủ. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trướớC`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} giờ trướớC`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} ngày trướớC`;
  return formatDateTime(iso);
}

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [read, setRead] = useState<'all' | 'read' | 'unread'>('all');
  const [moduleFilter, setModuleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [prefs, setPrefs] = useState<NotifyPrefs>(readNotifyPrefs);

  const params = new URLSearchParams({ page: String(page), pageSize: '15' });
  if (read !== 'all') params.set('read', read);
  if (moduleFilter) params.set('module', moduleFilter);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['notifications', 'center', read, moduleFilter, page],
    queryFn: () => apiFetch<NotificationPage>(`/notifications?${params.toString()}`),
  });

  const { data: moduleRows } = useQuery({
    queryKey: ['notifications', 'modules'],
    queryFn: () => apiFetch<{ items: { module: string; total: number }[] }>('/notifications/modules'),
  });

  useRealtimeInvalidate({ notification: [['notifications']] });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markRead = useMutation({
    mutationFn: (id: number) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => {
      refresh();
      toast.success('Đã đánh dấu đọc tất cả thông báo');
    },
  });
  const removeItem = useMutation({
    mutationFn: (id: number) => apiFetch(`/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const removeRead = useMutation({
    mutationFn: () => apiFetch('/notifications/read', { method: 'DELETE' }),
    onSuccess: (res) => {
      refresh();
      toast.success(`Đã xoá ${(res as { deleted: number }).deleted} thông báo đã đọc`);
    },
  });

  const open = (item: NotificationItem): void => {
    if (!item.readAt) markRead.mutate(item.id);
    if (item.link) router.push(item.link);
  };

  const setPref = (key: keyof NotifyPrefs, value: boolean): void => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    writeNotifyPrefs(next);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trung tâm thông báo"
        description="Mọi biến động của phiếu/hồ sơ liên quan tới bạn được ghi lại tại đây và báo tức thời qua thông báo nổi."
        actions={
          <>
            {data && data.unread > 0 ? (
              <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                <CheckCheck /> Đọc tất cả ({data.unread})
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm('Xoá toàn bộ thông báo ĐÃ ĐỌC?')) removeRead.mutate();
              }}
              disabled={removeRead.isPending}
            >
              <Trash2 /> Xoá đã đọc
            </Button>
          </>
        }
      />

      {/* Tuỳ chọn cảm nhận tức thời — lưu trên máy này */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-[var(--muted-foreground)]">
          <MonitorSmartphone className="size-4" /> Cảnh báo tức thời trên máy này:
        </span>
        <PrefToggle
          checked={prefs.toast}
          onChange={(v) => setPref('toast', v)}
          icon={BellRing}
          label="Thông báo nổi"
        />
        <PrefToggle
          checked={prefs.sound}
          onChange={(v) => setPref('sound', v)}
          icon={prefs.sound ? Volume2 : VolumeX}
          label="Âm thanh"
        />
        <PrefToggle
          checked={prefs.titleBadge}
          onChange={(v) => setPref('titleBadge', v)}
          icon={Bell}
          label="Số chưa đọc trên tab"
        />
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          {READ_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setRead(tab.key);
                setPage(1);
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition',
                read === tab.key
                  ? 'bg-[var(--primary)] font-medium text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
              )}
            >
              {tab.label}
              {tab.key === 'unread' && data && data.unread > 0 ? (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-px text-[10px] font-semibold text-white">
                  {data.unread > 99 ? '99+' : data.unread}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={moduleFilter === ''} onClick={() => { setModuleFilter(''); setPage(1); }} label="Mọi mô-đun" />
          {(moduleRows?.items ?? []).map((row) => (
            <FilterChip
              key={row.module}
              active={moduleFilter === row.module}
              onClick={() => { setModuleFilter(row.module); setPage(1); }}
              label={`${row.module} (${row.total})`}
            />
          ))}
        </div>
      </div>

      <Card className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--muted-foreground)]">
            <BellOff className="size-8" />
            <p>Không có thông báo nào với bộ lọc hiện tại.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {data!.items.map((item) => {
              const meta = LEVEL_META[item.level] ?? LEVEL_META.INFO;
              const Icon = meta.icon;
              const unread = !item.readAt;
              return (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 transition',
                    unread && 'bg-[var(--muted)]/40',
                    item.link && 'cursor-pointer hover:bg-[var(--muted)]/60',
                  )}
                  onClick={() => item.link && open(item)}
                >
                  <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', meta.className)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium text-[var(--foreground)]/80')}>
                        {item.title}
                      </span>
                      {unread ? <span className="size-2 shrink-0 rounded-full bg-sky-500" /> : null}
                      {item.module ? <Badge className="shrink-0">{item.module}</Badge> : null}
                    </span>
                    {item.body ? (
                      <span className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">{item.body}</span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]/80" title={formatDateTime(item.createdAt)}>
                      {timeAgo(item.createdAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {item.link ? (
                      <Button variant="ghost" size="icon" title="Mở" onClick={() => open(item)}>
                        <ExternalLink />
                      </Button>
                    ) : null}
                    {unread ? (
                      <Button variant="ghost" size="icon" title="Đánh dấu đã đọc" onClick={() => markRead.mutate(item.id)}>
                        <Check />
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon" title="Xoá" onClick={() => removeItem.mutate(item.id)}>
                      <Trash2 />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-[var(--muted-foreground)]">
            Trang {data.page}/{data.totalPages} · {data.total} thông báo
            {isFetching ? ' (đang tải…)' : ''}
          </span>
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition',
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/10 font-medium text-[var(--primary)]'
          : 'text-[var(--muted-foreground)] hover:border-[var(--foreground)]/40',
      )}
    >
      {label}
    </button>
  );
}

function PrefToggle({
  checked,
  onChange,
  icon: Icon,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  icon: typeof Bell;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm"
    >
      <span
        className={cn(
          'relative h-5 w-9 rounded-full transition',
          checked ? 'bg-[var(--primary)]' : 'bg-[var(--muted-foreground)]/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
      <Icon className="size-4 text-[var(--muted-foreground)]" />
      {label}
    </button>
  );
}
