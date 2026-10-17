"use client";

/** PROTOTYPE floating variant bar. Hidden in production builds. */
import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

const VARIANTS = [
  { key: "A", name: "Stat tiles then sections" },
  { key: "B", name: "Ledger table" },
  { key: "C", name: "Month sheet" },
] as const;

export function PrototypeSwitcher({ current, empty }: { current: string; empty: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = useCallback(
    (key: string, emptyFlag: boolean) => {
      const next = new URLSearchParams(params.toString());
      next.set("variant", key);
      if (emptyFlag) next.set("state", "empty");
      else next.delete("state");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const step = useCallback(
    (delta: number) => {
      const i = VARIANTS.findIndex((v) => v.key === current);
      go(VARIANTS[(i + delta + VARIANTS.length) % VARIANTS.length].key, empty);
    },
    [current, empty, go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (process.env.NODE_ENV === "production") return null;
  const meta = VARIANTS.find((v) => v.key === current);

  return (
    <div
      data-prototype-bar
      className="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-8 bg-[var(--ink)] px-12 py-8 text-[var(--paper)]"
    >
      <button type="button" aria-label="Previous variant" onClick={() => step(-1)} className="flex h-32 w-32 items-center justify-center">
        <CaretLeftIcon size={16} weight="bold" />
      </button>
      <span className="body-small whitespace-nowrap">
        {current} ({meta?.name})
      </span>
      <button type="button" aria-label="Next variant" onClick={() => step(1)} className="flex h-32 w-32 items-center justify-center">
        <CaretRightIcon size={16} weight="bold" />
      </button>
      <button
        type="button"
        onClick={() => go(current, !empty)}
        className="body-caption border border-[var(--paper)] px-8 py-4"
      >
        {empty ? "Show data" : "Empty month"}
      </button>
    </div>
  );
}
