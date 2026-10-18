/**
 * The Emissions overview's empty states: no credit batches at all, and
 * filters that match none. The filtered one names the filters and offers to
 * drop the one whose removal brings back the most batches.
 */
"use client";

import Link from "next/link";
import { FunnelSimpleIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, buttonVariants } from "@/components/ui";
import type { FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import { formatCount } from "@/lib/copy-utils";
import {
  BATCH_STATUS_LABELS,
  PERIOD_LABELS,
  filterAndSortBatches,
  type EmissionsOverviewQuery,
  type SetEmissionsOverviewQuery,
} from "./emissions-overview-query";

const NEW_CREDIT_BATCH_HREF = "/credit-batches?create=true";
const ANY_MONTH = "any month";

export function NoBatchesEmpty() {
  return (
    <EmptyState
      padding="md"
      icon={<StackIcon size={40} />}
      title="No credit batches yet"
      description="Each credit batch lists the lines its Removal template asks for. Create one to start recording emissions."
      action={
        <Link href={NEW_CREDIT_BATCH_HREF} className={buttonVariants({ variant: "default" })}>
          New credit batch
        </Link>
      }
    />
  );
}

type FilterReset = Partial<Record<"q" | "status" | "period" | "from" | "to", null>>;
interface ActiveFilter {
  name: string;
  text: string;
  reset: FilterReset;
}

function activeFilters(query: EmissionsOverviewQuery): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (query.status) {
    active.push({ name: "state", text: `state "${BATCH_STATUS_LABELS[query.status]}"`, reset: { status: null } });
  }
  if (query.period) {
    const range =
      query.period === "custom" ? `${query.from ?? ANY_MONTH} to ${query.to ?? ANY_MONTH}` : PERIOD_LABELS[query.period];
    active.push({ name: "period", text: `period "${range}"`, reset: { period: null, from: null, to: null } });
  }
  if (query.q) active.push({ name: "search", text: `search "${query.q}"`, reset: { q: null } });
  return active;
}

function joinNames(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

interface FilteredEmptyProps {
  batches: readonly FacilityEmissionsOverviewBatch[];
  query: EmissionsOverviewQuery;
  /** The facility's calendar day, YYYY-MM-DD. */
  today: string;
  setQuery: SetEmissionsOverviewQuery;
  onClear: () => void;
}

export function FilteredEmpty({ batches, query, today, setQuery, onClear }: FilteredEmptyProps) {
  const active = activeFilters(query);
  const best = active
    .map((filter) => {
      const relaxed: EmissionsOverviewQuery = {
        ...query,
        ...filter.reset,
        q: filter.reset.q === null ? "" : query.q,
      };
      return { filter, count: filterAndSortBatches(batches, relaxed, today).length };
    })
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)[0];
  const named = joinNames(active.map((filter) => filter.text));
  const description = best
    ? `No credit batch matches ${named}. Without the ${best.filter.name} filter, ${formatCount(best.count, "credit batch matches", "credit batches match")}.`
    : `No credit batch matches ${named}.`;
  const offerOne = best && active.length > 1;
  return (
    <EmptyState
      padding="md"
      icon={<FunnelSimpleIcon size={40} />}
      title="No credit batches match"
      description={description}
      action={
        <div className="flex flex-wrap justify-center gap-8">
          {offerOne && (
            <Button variant="default" onClick={() => void setQuery(best.filter.reset)}>
              {`Remove ${best.filter.name} filter`}
            </Button>
          )}
          <Button variant={offerOne ? "noOutline" : "default"} onClick={onClear}>
            Clear filters
          </Button>
        </div>
      }
    />
  );
}
