"use client";

/** PROTOTYPE floating variant bar. Hidden in production builds. */
import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATES, type MonthState } from "./report";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

const VARIANTS = [
  { key: "A", name: "Stat tiles then sections" },
  { key: "B", name: "Ledger table" },
  { key: "C", name: "Month sheet" },
] as const;

export function PrototypeSwitcher({ current, state }: { current: string; state: MonthState }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = useCallback(
    (key: string, nextState: MonthState) => {
      const next = new URLSearchParams(params.toString());
      next.set("variant", key);
      if (nextState !== "full") next.set("state", nextState);
      else next.delete("state");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const step = useCallback(
    (delta: number) => {
      const i = VARIANTS.findIndex((v) => v.key === current);
      go(VARIANTS[(i + delta + VARIANTS.length) % VARIANTS.length].key, state);
    },
    [current, state, go],
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
      className="fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100vw-16px)] flex-wrap justify-center -translate-x-1/2 items-center gap-8 bg-[var(--ink)] px-12 py-8 text-[var(--paper)]"
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
{STATES.map((st) => (
        <button
          key={st.key}
          type="button"
          onClick={() => go(current, st.key)}
          aria-pressed={state === st.key}
          className={`body-caption border border-[var(--paper)] px-8 py-4 ${state === st.key ? "bg-[var(--paper)] text-[var(--ink)]" : ""}`}
        >
          {st.name}
        </button>
      ))}
    </div>
  );
}
