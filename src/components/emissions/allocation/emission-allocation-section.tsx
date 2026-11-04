/**
 * The Allocation section: which credit batch (or Removal) carries each record
 * that causes emissions. Mounted on the credit batch Emissions tab and in the
 * Removal sheet; takes only the id of the batch or Removal it is about and
 * fetches its own data. Flow (default) or Table, switched with the Traceability
 * view control and kept in `?allocation=table`, a param neither host uses.
 */
"use client";

import { TreeStructureIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useId } from "react";
import { Button, Notice } from "@/components/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useEmissionAllocation } from "@/hooks/use-emission-allocation";
import type { EmissionAllocationInput } from "@/types/emission-allocation";
import { SECTION_TITLE, sectionHint } from "./allocation-copy";
import { FlowView } from "./allocation-flow-view";
import { ModeSwitch } from "./allocation-parts";
import { buildFocus } from "./allocation-model";
import { TableView } from "./allocation-table-view";

const VIEWS = ["flow", "table"] as const;
type AllocationViewMode = (typeof VIEWS)[number];
const VIEW_OPTIONS: { value: AllocationViewMode; label: string }[] = [
  { value: "flow", label: "Flow" },
  { value: "table", label: "Table" },
];
export const ALLOCATION_VIEW_PARAM = "allocation";
const QUERY_OPTIONS = { shallow: true, history: "replace", scroll: false } as const;
const BODY_SKELETON = "h-320 w-full";
const EMPTY_ICON_PX = 32;

export function EmissionAllocationSection(props: EmissionAllocationInput) {
  const headingId = useId();
  const input: EmissionAllocationInput = "creditBatchId" in props ? { creditBatchId: props.creditBatchId } : { removalId: props.removalId };
  const query = useEmissionAllocation(input);
  const [view, setView] = useQueryState(ALLOCATION_VIEW_PARAM, parseAsStringLiteral(VIEWS).withDefault("flow").withOptions(QUERY_OPTIONS));
  const allocation = query.data;
  const focus = allocation ? buildFocus(allocation, input) : null;
  const surface = "creditBatchId" in input ? "batch" : "removal";

  let body;
  if (query.error && !allocation) {
    body = (
      <Notice tone="error" action={<Button size="small" variant="default" onClick={() => void query.refetch()}>Try again</Button>}>
        {query.error.message || "The allocation could not be loaded."}
      </Notice>
    );
  } else if (!allocation) {
    body = <Skeleton className={BODY_SKELETON} />;
  } else if (!focus) {
    body = (
      <EmptyState
        padding="sm"
        icon={<WarningCircleIcon size={EMPTY_ICON_PX} aria-hidden />}
        title={surface === "batch" ? "This credit batch is not in the allocation" : "This Removal is not in the allocation"}
        description="Reload the page. If it stays, the record may have been deleted."
      />
    );
  } else if (allocation.records.length === 0) {
    body = (
      <EmptyState
        padding="sm"
        icon={<TreeStructureIcon size={EMPTY_ICON_PX} aria-hidden />}
        title="No emission sources yet"
        description="Feedstock deliveries, production runs, biochar deliveries and manual entries show up here once they exist."
      />
    );
  } else {
    body =
      view === "table" ? (
        <TableView key={focus.owner.key} allocation={allocation} focus={focus} />
      ) : (
        <FlowView key={focus.owner.key} allocation={allocation} focus={focus} />
      );
  }

  return (
    <section aria-labelledby={headingId} data-testid="emission-allocation" className="flex min-w-0 flex-col gap-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <span className="inline-flex items-center gap-6">
          <h2 id={headingId} className="title-heading-3">{SECTION_TITLE}</h2>
          <ExplanationInfo title={SECTION_TITLE} hint={sectionHint(surface)} />
        </span>
        <ModeSwitch legend="View mode" options={VIEW_OPTIONS} value={view} onChange={(next) => void setView(next === "flow" ? null : next)} className="w-max" />
      </div>
      {body}
    </section>
  );
}
