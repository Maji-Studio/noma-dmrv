/**
 * PROTOTYPE ONLY (#1058 PR 4). The variant switcher, outside the dialog
 * content. Plain links so each state has its own URL; `shot=1` hides it.
 */
"use client";

import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const VARIANTS = [
  { key: "a", label: "A submit step" },
  { key: "b", label: "B own step" },
  { key: "c", label: "C in selection" },
] as const;

export function PrototypeSwitcher() {
  const params = useSearchParams();
  if (typeof document === "undefined" || params.get("shot") === "1") return null;
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `?${next.toString()}`;
  };
  const current = params.get("proto");
  const scenario = params.get("scenario") ?? "one";
  return createPortal(
    <nav
      aria-label="Prototype variants"
      className="pointer-events-auto fixed bottom-16 left-16 z-[var(--z-layer-popover)] flex flex-wrap items-center gap-8 bg-[var(--paper)] px-12 py-8 body-caption [border:var(--hair)]"
    >
      <span className="font-medium">Prototype</span>
      {VARIANTS.map((v) => (
        <a key={v.key} href={href({ proto: v.key, step: null, confirmed: null })} className={cn("px-8 py-4", current === v.key ? "bg-[var(--color-interaction)] text-white" : "hover:underline")}>
          {v.label}
        </a>
      ))}
      <a href={href({ scenario: scenario === "two" ? "one" : "two" })} className="px-8 py-4 hover:underline">
        {scenario === "two" ? "Two batches" : "One batch"} (switch)
      </a>
    </nav>,
    document.body,
  );
}
