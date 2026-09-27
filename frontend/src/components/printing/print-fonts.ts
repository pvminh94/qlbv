'use client';

/**
 * Nạp font bản in cho trình thiết kế: lấy ĐÚNG tệp font mà máy chủ nhúng vào PDF
 * (GET /print/fonts/file) rồi đăng ký bằng FontFace API → khung vẽ hiển thị giống hệt bản in
 * (cùng độ rộng chữ, cùng chỗ xuống dòng).
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { BUILTIN_FONTS, DEFAULT_FONT, canonicalFont } from './print-types';

export interface FontFamilyInfo {
  family: string;
  source: 'builtin' | 'custom' | 'mixed';
  substitute: string | null;
  isDefault: boolean;
  variants: Record<
    'regular' | 'bold' | 'italic' | 'boldItalic',
    { available: boolean; source: 'builtin' | 'custom' | 'fallback'; fileName?: string; missingVietnamese?: string }
  >;
}

const VARIANTS: { key: 'regular' | 'bold' | 'italic' | 'boldItalic'; weight: string; style: string }[] = [
  { key: 'regular', weight: '400', style: 'normal' },
  { key: 'bold', weight: '700', style: 'normal' },
  { key: 'italic', weight: '400', style: 'italic' },
  { key: 'boldItalic', weight: '700', style: 'italic' },
];

const loaded = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let familiesCache: FontFamilyInfo[] | null = null;
let familiesPromise: Promise<FontFamilyInfo[]> | null = null;
/** Tăng mỗi lần danh sách font thay đổi (tải lên/xoá) để nạp lại tệp */
let generation = 0;

const faceName = (family: string): string => `QLBS ${canonicalFont(family)}${generation ? ` g${generation}` : ''}`;

/** Chuỗi CSS font-family cho một họ font bản in */
export function cssFontFamily(family?: string | null): string {
  const fam = canonicalFont(family);
  const fallback = fam === 'Arial' ? 'Arimo, Arial, sans-serif' : fam === 'Courier New' ? 'Cousine, "Courier New", monospace' : 'Tinos, "Times New Roman", serif';
  return `"${faceName(fam)}", "${fam}", ${fallback}`;
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function ensureFont(family?: string | null): Promise<void> {
  const fam = canonicalFont(family);
  const key = `${generation}|${fam}`;
  const existing = loaded.get(key);
  if (existing) return existing;
  const name = faceName(fam);
  const p = (async () => {
    if (typeof window === 'undefined' || !('FontFace' in window)) return;
    await Promise.all(
      VARIANTS.map(async (v) => {
        try {
          const res = await apiFetch<Response>(
            `/print/fonts/file?family=${encodeURIComponent(fam)}&variant=${v.key}`,
            { raw: true },
          );
          const buf = await res.arrayBuffer();
          const face = new FontFace(name, buf, { weight: v.weight, style: v.style });
          await face.load();
          document.fonts.add(face);
        } catch {
          /* bỏ qua — trình duyệt dùng font dự phòng */
        }
      }),
    );
    notify();
  })();
  loaded.set(key, p);
  return p;
}

export function fetchFontFamilies(force = false): Promise<FontFamilyInfo[]> {
  if (familiesCache && !force) return Promise.resolve(familiesCache);
  if (familiesPromise && !force) return familiesPromise;
  familiesPromise = apiFetch<{ default: string; families: FontFamilyInfo[] }>('/print/fonts')
    .then((r) => {
      familiesCache = r.families;
      notify();
      return r.families;
    })
    .catch(() => {
      familiesPromise = null;
      return [];
    });
  return familiesPromise;
}

/** Gọi sau khi tải lên/xoá font: nạp lại danh sách và tệp font */
export async function reloadFonts(): Promise<void> {
  generation += 1;
  await fetchFontFamilies(true);
  notify();
}

/** Danh sách font + tự nạp các font đang dùng; trả về số "phiên bản" để vẽ lại khi font nạp xong */
export function usePrintFonts(used: string[] = []): { families: string[]; info: FontFamilyInfo[]; version: number } {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    listeners.add(fn);
    void fetchFontFamilies();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const key = Array.from(new Set([DEFAULT_FONT, ...used.map(canonicalFont)])).sort().join('|');
  useEffect(() => {
    key.split('|').forEach((f) => void ensureFont(f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version === 0 ? 0 : generation]);
  const info = familiesCache ?? [];
  const families = Array.from(new Set([...BUILTIN_FONTS, ...info.map((f) => f.family)]));
  return { families, info, version };
}
