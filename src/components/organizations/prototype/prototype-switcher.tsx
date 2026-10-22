/**
 * PROTOTYPE (#1373). Floating variant switcher, outside the design being
 * judged. Hidden in production builds.
 */
"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const VARIANTS = [
  { key: "today", name: "Today" },
  { key: "A", name: "List page" },
  { key: "B", name: "Platform shell" },
  { key: "C", name: "Organization pages" },
  { key: "D", name: "Inside Settings" },
] as const;

export function PrototypeSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = Math.max(0, VARIANTS.findIndex((v) => v.key === current));

  function go(step: number) {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
    const q = new URLSearchParams(params.toString());
    q.set("variant", next.key);
    router.replace(`${pathname}?${q.toString()}`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;
  const v = VARIANTS[index];
  return (
    <div
      data-prototype-switcher
      className="fixed bottom-[16px] left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-[8px] rounded-full bg-[#ffd400] px-[12px] py-[6px] font-mono text-[13px] text-black shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      <button type="button" aria-label="Previous variant" className="px-[8px] py-[4px]" onClick={() => go(-1)}>←</button>
      <span>{v.key} ({v.name})</span>
      <button type="button" aria-label="Next variant" className="px-[8px] py-[4px]" onClick={() => go(1)}>→</button>
    </div>
  );
}
