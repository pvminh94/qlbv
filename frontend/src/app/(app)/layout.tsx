'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';

/**
 * Khu vực yêu cầu đăng nhập: kiểm tra token rồi nạp thông tin người dùng,
 * sau đó mới hiện giao diện để tránh nhấp nháy menu sai quyền.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const loadMe = useAuth((s) => s.loadMe);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokenStore.access) {
        router.replace('/login');
        return;
      }
      if (!user) await loadMe();
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, user, loadMe]);

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          Đang tải hệ thống…
        </div>
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <AppShell>{children}</AppShell>
    </RealtimeProvider>
  );
}
