/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Floating
 * bar outside the design being judged: the surface, the batch or Removal in
 * focus and the Removal fixture. Flow and Table are switched on the page
 * itself. Hidden in production builds.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BATCHES, REMOVALS, type RemovalFixture, type Surface } from "./fixture";

const CONTROL = "h-32 border border-[rgba(0,0,0,0.4)] bg-[rgba(255,255,255,0.7)] px-6 font-mono text-[12px] text-[#000]";

export function AllocationSwitcher({ surface, focusKey, fixture }: { surface: Surface; focusKey: string; fixture: RemovalFixture }) {
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
      className="fixed bottom-[12px] left-1/2 z-[9999] flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-4 rounded-[20px] bg-[#ffd400] px-[10px] py-[6px] font-mono text-[13px] text-[#000] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      <span className="px-[4px]">Prototype</span>
      <select aria-label="Surface" className={CONTROL} value={surface} onChange={(e) => set({ surface: e.target.value, focus: null })}>
        <option value="batch">Batch</option>
        <option value="removal">Removal</option>
      </select>
      <select aria-label="Focus" className={CONTROL} value={focusKey} onChange={(e) => set({ focus: e.target.value })}>
        {picks.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
      {surface === "removal" && (
        <select aria-label="Removals" className={CONTROL} value={fixture} onChange={(e) => set({ removals: e.target.value, focus: null })}>
          <option value="one">1 batch each</option>
          <option value="two">2 in RM-002</option>
        </select>
      )}
    </div>
  );
}
