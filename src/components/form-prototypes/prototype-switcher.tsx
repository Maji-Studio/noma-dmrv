"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";

import { PROTOTYPE_VARIANTS, PROTOTYPE_NAMES, type PrototypeVariant } from "./prototype-variants";

export function PrototypeSwitcher({ variant }: { variant: PrototypeVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function cycle(direction: number) {
    const index = PROTOTYPE_VARIANTS.indexOf(variant);
    const next = PROTOTYPE_VARIANTS[(index + direction + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length];
    const query = new URLSearchParams(params.toString());
    query.set("variant", next);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, button, summary, [contenteditable], [role=radio]")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowLeft" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  return <nav aria-label="Prototype variants" className="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-12 border border-[var(--hair)] bg-[var(--paper)] p-8">
    <Button aria-label="Previous variant" className="min-h-44 min-w-44" onClick={() => cycle(-1)}>←</Button>
    <span className="body-small whitespace-nowrap" aria-live="polite">{variant} · {PROTOTYPE_NAMES[variant]}</span>
    <Button aria-label="Next variant" className="min-h-44 min-w-44" onClick={() => cycle(1)}>→</Button>
  </nav>;
}
