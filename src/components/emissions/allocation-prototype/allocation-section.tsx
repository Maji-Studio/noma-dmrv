/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). The one
 * Allocation section both surfaces mount: a heading with its (i), then Flow
 * (default) or Table, switched with the Traceability view control and kept in
 * `?view=`.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import type { Focus, RemovalFixture } from "./fixture";
import { FlowView } from "./flow-view";
import { SegmentGroup } from "./parts";
import { TableView } from "./table-view";

export type AllocationView = "flow" | "table";

const VIEWS: { value: AllocationView; label: string }[] = [
  { value: "flow", label: "Flow" },
  { value: "table", label: "Table" },
];

export function AllocationSection({ focus, fixture, view }: { focus: Focus; fixture: RemovalFixture; view: AllocationView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setView = (next: AllocationView) => {
    const q = new URLSearchParams(params.toString());
    if (next === "flow") q.delete("view");
    else q.set("view", next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const across = focus.surface === "batch" ? "credit batches" : "Removals";
  return (
    <section aria-labelledby="allocation" className="flex min-w-0 flex-col gap-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <span className="inline-flex items-center gap-6">
          <h2 id="allocation" className="title-heading-3">Allocation</h2>
          <ExplanationInfo
            title="Allocation"
            hint={`Each record that causes emissions is split across ${across} by what each one used of it, so every record adds up to 100% and nothing is counted twice. Hatched is still in the bin. noma sends the quantities; Isometric turns them into emissions.`}
          />
        </span>
        <SegmentGroup label="View mode" options={VIEWS} value={view} onChange={setView} />
      </div>
      {view === "flow" ? <FlowView key={focus.owner.key} focus={focus} fixture={fixture} onOpenTable={() => setView("table")} /> : <TableView focus={focus} />}
    </section>
  );
}
