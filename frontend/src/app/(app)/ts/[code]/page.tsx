'use client';

import { Loader2, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** Đích của mã QR trên tem tài sản: /ts/<mã> → tra mã → mở hồ sơ */
export default function AssetQrRedirect() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [err, setErr] = useState('');
  useEffect(() => {
    apiFetch<{ id: number }>(`/assets/lookup/${encodeURIComponent(decodeURIComponent(code))}`)
      .then((a) => router.replace(`/tai-san/${a.id}`))
      .catch((e) => setErr((e as Error).message));
  }, [code, router]);
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      {err ? (
        <div className="space-y-2">
          <SearchX className="mx-auto size-10 text-red-500" />
          <div className="font-medium">{err}</div>
          <Link href="/tai-san/tra-cuu" className="text-sm text-teal-700 hover:underline">
            Tra cứu mã khác
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="size-4 animate-spin" /> Đang mở tài sản {decodeURIComponent(code)}…
        </div>
      )}
    </div>
  );
}
