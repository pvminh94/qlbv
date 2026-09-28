'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, MessageSquare, Paperclip, Send, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { apiFetch, openFileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

/* ---------------------------------------------------------------- Trao đổi */

interface CommentItem {
  id: number;
  requestId: number;
  userId: number;
  username: string;
  fullName: string;
  content: string;
  createdAt: string;
  canDelete?: boolean;
}

export function CommentsPanel({ requestId }: { requestId: number }) {
  const can = useAuth((s) => s.can);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['hsba-comments', requestId],
    queryFn: () => apiFetch<CommentItem[]>(`/hsba/requests/${requestId}/comments`),
    refetchInterval: 20_000, // bình luận thường không nhiều — polling 20s là đủ "realtime" cho nội bộ
  });

  const add = useMutation({
    mutationFn: () =>
      apiFetch<CommentItem>(`/hsba/requests/${requestId}/comments`, {
        method: 'POST',
        body: { content: text.trim() },
      }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['hsba-comments', requestId] });
      messageRef.current?.focus();
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: number) =>
      apiFetch(`/hsba/requests/${requestId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hsba-comments', requestId] }),
  });

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
        <MessageSquare className="size-4" /> Trao đổi nội bộ
        {data ? <span className="text-xs font-normal text-[var(--muted-foreground)]">({data.length})</span> : null}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Chưa có trao đổi"
          description="Ghi lại các trao đổi giữa ngườI đề nghị, KHTH và tài chính để phiếu có bối cảnh rõ ràng."
        />
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {data?.map((c) => (
            <li key={c.id} className="group flex items-start gap-2 px-4 py-2.5">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[10px] font-semibold">
                {c.fullName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{c.fullName}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">{formatDateTime(c.createdAt)}</span>
                  {c.canDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Xoá trao đổi này?')) remove.mutate(c.id);
                      }}
                      className="ml-auto text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--destructive,#b91c1c)] group-hover:opacity-100"
                      title="Xoá trao đổi"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{c.content}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {can('hsba.request.comment') ? (
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={messageRef}
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim() && !add.isPending) add.mutate();
                }
              }}
              placeholder="Nhập trao đổi… (Enter để gửi, Shift+Enter xuống dòng)"
              className="text-sm"
              maxLength={2000}
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={!text.trim() || add.isPending}
              onClick={() => add.mutate()}
            >
              <Send /> {add.isPending ? 'Gửi…' : 'Gửi'}
            </Button>
          </div>
          {add.isError ? (
            <p className="mt-1 text-xs text-[var(--destructive,#b91c1c)]">Gửi không thành công — vui lòng thử lại</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- Tệp minh chứng */

interface AttachmentItem {
  id: number;
  requestId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string;
  uploadedBy: number;
  fullName: string;
  createdAt: string;
  canDelete?: boolean;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

const ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx';
const MAX_FILE = 12 * 1024 * 1024;

export function AttachmentsPanel({ requestId, finished }: { requestId: number; finished: boolean }) {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [note, setNote] = useState('');
  const [clientError, setClientError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['hsba-attachments', requestId],
    queryFn: () => apiFetch<AttachmentItem[]>(`/hsba/requests/${requestId}/attachments`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(new Error('Đọc tệp thất bại'));
        r.readAsDataURL(file);
      });
      return apiFetch<AttachmentItem>(`/hsba/requests/${requestId}/attachments`, {
        method: 'POST',
        body: { fileName: file.name, mimeType: file.type, contentBase64: base64, note: note.trim() },
      });
    },
    onSuccess: () => {
      setNote('');
      setClientError('');
      void queryClient.invalidateQueries({ queryKey: ['hsba-attachments', requestId] });
    },
  });

  const remove = useMutation({
    mutationFn: (attachmentId: number) =>
      apiFetch(`/hsba/requests/${requestId}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hsba-attachments', requestId] }),
  });

  const pickFile = (f: File | undefined): void => {
    setClientError('');
    if (!f) return;
    if (!ACCEPT.split(',').some((ext) => f.name.toLowerCase().endsWith(ext))) {
      setClientError('Chỉ nhận ảnh (PNG/JPG/WebP), PDF, Word, Excel');
      return;
    }
    if (f.size > MAX_FILE) {
      setClientError(`Tệp vượt ${MAX_FILE / (1024 * 1024)}MB`);
      return;
    }
    upload.mutate(f);
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
        <Paperclip className="size-4" /> Tệp minh chứng
        {data ? <span className="text-xs font-normal text-[var(--muted-foreground)]">({data.length})</span> : null}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Chưa có tệp minh chứng"
          description="Đính kèm sổ BHYT, phiếu thanh toán, ảnh chứng từ… để bộ phận duyệt đủ căn cứ."
        />
      ) : (
        <ul className="divide-y">
          {data?.map((a) => (
            <li key={a.id} className="group flex items-start gap-2 px-4 py-2.5">
              <Paperclip className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => void openFileUrl(`/api/hsba/requests/${requestId}/attachments/${a.id}`)}
                  className="block max-w-full truncate text-left text-sm font-medium text-[var(--primary)] hover:underline"
                  title="Xem / tải tệp"
                >
                  {a.fileName}
                </button>
                <div className="text-[10px] text-[var(--muted-foreground)]">
                  {fmtBytes(a.sizeBytes)} · {a.fullName} · {formatDateTime(a.createdAt)}
                </div>
                {a.note ? <p className="mt-0.5 text-xs italic text-[var(--muted-foreground)]">{a.note}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => void openFileUrl(`/api/hsba/requests/${requestId}/attachments/${a.id}`)}
                  className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                  title="Tải / xem"
                >
                  <Download className="size-3.5" />
                </button>
                {a.canDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Xoá tệp "${a.fileName}"?`)) remove.mutate(a.id);
                    }}
                    className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive,#b91c1c)]"
                    title="Xoá tệp"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!finished && can('file.upload') ? (
        <div className="space-y-2 border-t p-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú cho tệp (không bắt buộc)…"
            className="h-8.5 w-full rounded-lg border bg-transparent px-3 text-sm"
            maxLength={500}
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload /> {upload.isPending ? 'Đang tải lên…' : 'Đính kèm tệp'}
            </Button>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Ảnh / PDF / Word / Excel · tối đa {MAX_FILE / (1024 * 1024)}MB
            </span>
          </div>
          {clientError ? (
            <p className="text-xs text-[var(--destructive,#b91c1c)]">{clientError}</p>
          ) : null}
          {upload.isError ? (
            <p className={cn('text-xs text-[var(--destructive,#b91c1c)]')}>Tải lên thất bại — kiểm tra tệp rồi thử lại</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
