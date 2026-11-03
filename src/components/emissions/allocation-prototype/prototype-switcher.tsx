/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Floating
 * bar outside the design being judged: the surface, the batch or Removal in
 * focus, the Removal fixture and the hint treatment (A rows, B notice). Flow
 * and Table are switched on the page itself. Hidden in production builds.
 * On phones it sits at the bottom right, clear of the account button and the
 * dev badge at the bottom left.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BATCHES, REMOVALS, type RemovalFixture, type Surface } from "./fixture";
import { HINT_MODES, type HintMode } from "./hints";

const CONTROL = "h-32 border border-[rgba(0,0,0,0.4)] bg-[rgba(255,255,255,0.7)] px-4 font-mono text-[11px] text-[#000] sm:px-6 sm:text-[12px]";

export function AllocationSwitcher({ surface, focusKey, fixture, hint }: { surface: Surface; focusKey: string; fixture: RemovalFixture; hint: HintMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null) q.delete(key);
      else q.set(key, value);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  if (process.env.NODE_ENV === "production") return null;
  const picks = surface === "batch" ? BATCHES.map((batch) => batch.code) : REMOVALS[fixture].map((removal) => removal.code);
  return (
    <div
      data-prototype-switcher
      className="fixed right-[8px] bottom-[12px] z-[9999] flex w-max max-w-[calc(100vw-72px)] flex-wrap items-center justify-end gap-4 rounded-[20px] bg-[#ffd400] px-[8px] py-[6px] font-mono text-[13px] text-[#000] shadow-[0_4px_16px_rgba(0,0,0,0.3)] sm:right-auto sm:left-1/2 sm:max-w-[calc(100vw-16px)] sm:-translate-x-1/2 sm:justify-center sm:px-[10px]"
    >
      <span className="hidden px-[4px] sm:inline">Prototype</span>
      <select aria-label="Surface" className={CONTROL} value={surface} onChange={(e) => set({ surface: e.target.value, focus: null })}>
        <option value="batch">Batch</option>
        <option value="removal">Removal</option>
      </select>
      <select aria-label="Focus" className={CONTROL} value={focusKey} onChange={(e) => set({ focus: e.target.value })}>
        {picks.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
      {surface === "removal" && (
        <select aria-label="Removals" className={CONTROL} value={fixture} onChange={(e) => set({ removals: e.target.value, focus: null })}>
          <option value="one">1 each</option>
          <option value="two">2 in RM-002</option>
        </select>
      )}
      <select aria-label="Hint" className={CONTROL} value={hint} onChange={(e) => set({ hint: e.target.value === "a" ? null : e.target.value })}>
        {HINT_MODES.map((mode) => <option key={mode.value} value={mode.value}>Hint {mode.label}</option>)}
      </select>
    </div>
  );
}
