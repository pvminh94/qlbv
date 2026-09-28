'use client';

/**
 * Realtime (SSE) — một kết nối duy nhất cho toàn ứng dụng.
 *
 * Trình duyệt xác thực bằng cookie `qlbs_access` (được set lúc đăng nhập và
 * làm mới qua `ensureFileSession`). Khi nhận sự kiện, các trang đăng ký sẽ
 * invalidate React Query → số liệu tự cập nhật mà không cần polling.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ensureFileSession } from './api';

export interface RealtimeEvent {
  topic: string;
  type: string;
  at: string;
  departmentId?: number | null;
  data?: Record<string, unknown>;
}

type Handler = (event: RealtimeEvent) => void;

const RealtimeContext = createContext<{
  connected: boolean;
  subscribe: (handler: Handler) => () => void;
}>({ connected: false, subscribe: () => () => undefined });

const RETRY_MS = 5_000;

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Set<Handler>());

  useEffect(() => {
    let source: EventSource | null = null;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        // Bảo đảm cookie phiên còn hạn trước khi mở kết nối (EventSource không
        // gửi được header Authorization — backend đọc cookie qlbs_access)
        await ensureFileSession();
      } catch {
        /* cứ thử kết nối; nếu 401 sẽ retry sau */
      }
      if (stopped) return;
      source = new EventSource('/api/realtime/stream');
      source.onopen = () => setConnected(true);
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as RealtimeEvent;
          handlers.current.forEach((handler) => {
            try { handler(event); } catch { /* một handler lỗi không chặn handler khác */ }
          });
        } catch {
          /* dòng ping/comment — bỏ qua */
        }
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        source = null;
        if (!stopped) retryTimer = setTimeout(connect, RETRY_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, []);

  const subscribe = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => handlers.current.delete(handler);
  }, []);

  return (
    <RealtimeContext.Provider value={{ connected, subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Đăng ký nhận sự kiện realtime (handler được giữ tham chiếu ổn định) */
export function useRealtimeEvent(handler: Handler): void {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}

/**
 * Cứ khi có sự kiện thuộc các topic khai báo → invalidate các queryKey tương ứng.
 * Có gom nhịp (mỗi prefix tối đa 1 lần / intervalMs) để màn hình không giật
 * khi sự kiện về dồn dập (ví dụ quét kiểm kê hàng loạt).
 */
export function useRealtimeInvalidate(
  mapping: Record<string, (string | number)[][]>,
  intervalMs = 2_000,
): void {
  const queryClient = useQueryClient();
  const lastRun = useRef<Record<string, number>>({});
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Key ổn định để không đăng ký lại liên tục
  const signature = JSON.stringify(mapping);

  useRealtimeEvent(useCallback((event: RealtimeEvent) => {
    const map = JSON.parse(signature) as Record<string, (string | number)[][]>;
    const keys = map[event.topic] ?? map['*'];
    if (!keys?.length) return;
    const now = Date.now();
    for (const key of keys) {
      const id = JSON.stringify(key);
      const elapsed = now - (lastRun.current[id] ?? 0);
      const run = () => {
        lastRun.current[id] = Date.now();
        delete pending.current[id];
        void queryClient.invalidateQueries({ queryKey: key });
      };
      if (elapsed >= intervalMs) run();
      else if (!pending.current[id]) {
        pending.current[id] = setTimeout(run, intervalMs - elapsed);
      }
    }
  }, [signature, intervalMs, queryClient]));
}

/** Chấm trạng thái "Trực tiếp / Ngoại tuyến" */
export function RealtimeDot({ className = '' }: { className?: string }) {
  const { connected } = useRealtime();
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${className}`}
      title={connected ? 'Đang kết nối realtime — số liệu tự cập nhật' : 'Mất kết nối realtime — đang thử lại…'}
    >
      <span className="relative flex size-2">
        {connected && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-300'}`}
        />
      </span>
      <span className={connected ? 'text-emerald-600' : 'text-[var(--muted-foreground)]'}>
        {connected ? 'Trực tiếp' : 'Ngoại tuyến'}
      </span>
    </span>
  );
}
