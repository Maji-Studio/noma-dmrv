/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). The one
 * Allocation section both surfaces mount: a heading with its (i), then Flow
 * (default) or Table, switched with the Traceability view control and kept in
 * `?view=`. Round 3: the hint treatment (`?hint=a|b`) and the flow's quantity
 * and pinned node live here, so B's notice can light a delivery in the flow.
 * The parent keys this section by the page's batch or Removal.
 */
"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import type { Focus, RemovalFixture } from "./fixture";
import { FlowView, type StreamKey } from "./flow-view";
import { HintNotice, jumpToRow, type HintMode } from "./hints";
import { SegmentGroup } from "./parts";
import { TableView } from "./table-view";

export type AllocationView = "flow" | "table";

const VIEWS: { value: AllocationView; label: string }[] = [
  { value: "flow", label: "Flow" },
  { value: "table", label: "Table" },
];

export function AllocationSection({ focus, fixture, view, hint }: { focus: Focus; fixture: RemovalFixture; view: AllocationView; hint: HintMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [stream, setStream] = useState<StreamKey>("feedstock");
  const [pinned, setPinned] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const setView = (next: AllocationView) => {
    const q = new URLSearchParams(params.toString());
    if (next === "flow") q.delete("view");
    else q.set("view", next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const jump = (recordId: string) => {
    setFlash(recordId);
    if (view === "flow") {
      setStream("feedstock");
      setPinned(recordId);
      requestAnimationFrame(() => document.querySelector("[data-allocation-flow-panel]")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } else jumpToRow(recordId);
  };
  const across = focus.surface === "batch" ? "a credit batch" : "a Removal";
  return (
    <section aria-labelledby="allocation" className="flex min-w-0 flex-col gap-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <span className="inline-flex items-center gap-6">
          <h2 id="allocation" className="title-heading-3">Allocation</h2>
          <ExplanationInfo
            title="Allocation"
            hint={`Each record that causes emissions is counted once. A feedstock delivery's transport goes whole to the credit batch that drew from it first; a biochar delivery is split by the biochar each batch has on the load. What ${across} carries adds up here. Hatched is not yet allocated. noma sends the quantities; Isometric turns them into emissions.`}
          />
        </span>
        <SegmentGroup label="View mode" options={VIEWS} value={view} onChange={setView} />
      </div>
      {hint === "b" && <HintNotice focus={focus} onJump={jump} />}
      {view === "flow" ? (
        <FlowView
          focus={focus}
          fixture={fixture}
          hint={hint}
          streamKey={stream}
          onStream={(next) => {
            setStream(next);
            setPinned(null);
          }}
          pinned={pinned}
          onPin={setPinned}
          onOpenTable={() => setView("table")}
        />
      ) : (
        <TableView focus={focus} hint={hint} flash={flash} />
      )}
    </section>
  );
}
