"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteColor {
  value: string;
  label: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Chọn màu bằng bảng màu có sẵn (không cần gõ mã); "Màu khác" mở bộ chọn màu của trình duyệt. */
export function ColorPicker({
  id,
  value,
  palette = [],
  onChange,
}: {
  id?: string;
  value: string;
  palette?: PaletteColor[];
  onChange: (hex: string) => void;
}) {
  const current = HEX.test(value) ? value.toUpperCase() : "";
  const named = palette.find((c) => c.value.toUpperCase() === current);
  return (
    <div id={id} className="space-y-2.5">
      {palette.length ? (
        <div role="radiogroup" aria-label="Bảng màu" className="grid grid-cols-6 gap-x-2 gap-y-2.5">
          {palette.map((c) => {
            const selected = c.value.toUpperCase() === current;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={c.label}
                title={c.label}
                onClick={() => onChange(c.value.toUpperCase())}
                className={cn(
                  "relative mx-auto flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition",
                  "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
                  selected && "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--card)]",
                )}
                style={{ background: c.value }}
              >
                {selected ? <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: HEX.test(value) ? value : "transparent" }} />
          {named ? named.label : current ? `Màu tuỳ chọn ${current}` : "Chưa chọn màu"}
        </span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-[var(--card)] px-2.5 py-1.5 font-medium text-[var(--foreground)] hover:bg-[var(--accent)]">
          <input
            type="color"
            aria-label="Chọn màu khác"
            value={current ? current.toLowerCase() : "#0f766e"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-5 w-5 cursor-pointer appearance-none rounded border-0 bg-transparent p-0"
          />
          Màu khác
        </label>
      </div>
    </div>
  );
}
