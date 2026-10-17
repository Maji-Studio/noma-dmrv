/** PROTOTYPE (issue #1004): floating variant switcher. Hidden in production builds. */
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export const VARIANTS = [
  { key: "A", name: "Disclosure under each entry" },
  { key: "B", name: "Popover on the wet total" },
  { key: "C", name: "Stacked bars" },
] as const;

export type VariantKey = (typeof VARIANTS)[number]["key"];

const SWITCHER_Z = 2000;

/** The active variant, or null when the prototype is off. */
export function useProtoVariant(): VariantKey | null {
  const params = useSearchParams();
  if (process.env.NODE_ENV === "production") return null;
  const value = params.get("variant");
  return VARIANTS.some((variant) => variant.key === value) ? (value as VariantKey) : null;
}

export function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter();
  const params = useSearchParams();
  const index = VARIANTS.findIndex((variant) => variant.key === current);
  const go = (step: number) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key;
    const search = new URLSearchParams(params.toString());
    search.set("variant", next);
    router.replace(`?${search.toString()}`, { scroll: false });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div data-testid="proto-switcher" style={{ zIndex: SWITCHER_Z }} className="fixed bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-4 bg-[var(--clr-dark-purple-80)] px-8 py-4 text-[var(--paper)] [border:var(--hair)]">
      <button type="button" aria-label="Previous variant" onClick={() => go(-1)} className="min-h-44 min-w-44 cursor-pointer">←</button>
      <span className="body-small whitespace-nowrap px-4">{current} ({VARIANTS[index].name})</span>
      <button type="button" aria-label="Next variant" onClick={() => go(1)} className="min-h-44 min-w-44 cursor-pointer">→</button>
    </div>
  );
}
