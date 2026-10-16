/**
 * PROTOTYPE, throwaway branch `prototype/emissions-variants`, never merged.
 *
 * Question: what should the Emissions area look like? It is where operators
 * add every emission line that a credit batch's Removal template asks for
 * (epic #1058 PR 3, plan docs/plans/2026-10-15-template-driven-emissions.md
 * §4.4).
 *
 * Round 2 (Kenji 2026-10-16: "C is the best ... make 3 more detail
 * variants"): A and B are retired (files kept, unused). The switcher cycles
 * `?variant=C1|C2|C3`; `?variant=C` (or any unknown key) maps to C1. All three
 * share the fleshed-out ledger overview (prototype-overview.tsx) and differ
 * only on `/emissions/[creditBatchId]`.
 *   C1 "Refined ledger": prototype-detail-c1.tsx
 *   C2, C3: prototype-detail-c2.tsx, prototype-detail-c3.tsx
 * Shared detail API: prototype-detail-shared.tsx. URL keys:
 * prototype-ledger-query.ts.
 *
 * Real: the shell, facility and credit batches (dev DB, read only). Stubbed in
 * memory: template lines, states, entries and 9 older credit batches
 * (prototype-emissions-data.ts).
 */
"use client";

import { useSearchParams } from "next/navigation";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { PrototypeSwitcher, resolveVariant } from "@/components/ui/prototype-switcher";
import { prototypeActions } from "./prototype-emissions-data";
import { useEmissionsHref, usePrototypeEmissions } from "./prototype-emissions-shared";
import { LedgerOverview, OVERVIEW_SUBTITLE as SUBTITLE } from "./prototype-overview";
import { DETAIL_C1_NAME, DetailC1 } from "./prototype-detail-c1";
import { DETAIL_C2_NAME, DetailC2 } from "./prototype-detail-c2";
import { DETAIL_C3_NAME, DetailC3 } from "./prototype-detail-c3";
import { DETAIL_C3A_NAME, DetailC3A } from "./prototype-detail-c3a";
import { DETAIL_C3B_NAME, DetailC3B } from "./prototype-detail-c3b";
import { DETAIL_C3C_NAME, DetailC3C } from "./prototype-detail-c3c";
import Link from "next/link";

const VARIANTS = [
  { key: "C1", name: DETAIL_C1_NAME },
  { key: "C2", name: DETAIL_C2_NAME },
  { key: "C3", name: DETAIL_C3_NAME },
  { key: "C3a", name: DETAIL_C3A_NAME },
  { key: "C3b", name: DETAIL_C3B_NAME },
  { key: "C3c", name: DETAIL_C3C_NAME },
] as const;
const DETAILS = { C1: DetailC1, C2: DetailC2, C3: DetailC3, C3a: DetailC3A, C3b: DetailC3B, C3c: DetailC3C } as const;

export function EmissionsPrototype({ creditBatchId }: { creditBatchId?: string }) {
  const searchParams = useSearchParams();
  const variant = resolveVariant(VARIANTS, searchParams.get("variant"));
  const data = usePrototypeEmissions();
  const href = useEmissionsHref();

  let body: React.ReactNode;
  if (!data.facilityId) {
    body = (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to see its emissions lines." />
      </div>
    );
  } else if (data.isLoading) {
    body = (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
        <Skeleton className="h-320 w-full" />
      </div>
    );
  } else if (creditBatchId && !data.batches.some((b) => b.batch.id === creditBatchId)) {
    body = (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title="Emissions" subtitle={SUBTITLE} />
        <EmptyState
          padding="md"
          icon={<ReceiptIcon size={32} weight="bold" />}
          title="Credit batch not found"
          description="It may belong to another facility."
          action={<Link href={href()} className="body-small font-medium underline underline-offset-4">Back to Emissions</Link>}
        />
      </div>
    );
  } else if (creditBatchId) {
    const Detail = DETAILS[variant.key as keyof typeof DETAILS] ?? DetailC1;
    body = <Detail data={data} batchId={creditBatchId} />;
  } else body = <LedgerOverview data={data} />;

  return (
    <>
      {body}
      {/* Room for the floating switcher so it never covers the last row. */}
      <div className="h-80" aria-hidden="true" />
      <PrototypeSwitcher variants={VARIANTS} title="Emissions prototype">
        <StubState data={data} variant={`${variant.key} (${variant.name})`} route={creditBatchId ? "/emissions/[creditBatchId]" : "/emissions"} />
      </PrototypeSwitcher>
    </>
  );
}

const URL_STATE_KEYS = ["q", "status", "period", "from", "to", "sort", "dir", "lines", "lsort"];

function StubState({ data, variant, route }: { data: ReturnType<typeof usePrototypeEmissions>; variant: string; route: string }) {
  const searchParams = useSearchParams();
  const urlState = URL_STATE_KEYS.filter((key) => searchParams.get(key)).map((key) => `${key}=${searchParams.get(key)}`).join(", ");
  return (
    <div className="flex flex-col gap-8">
      <div>{`Variant ${variant} on ${route}. Last action: ${data.store.lastAction}. Store version ${data.store.version}.`}</div>
      <div>{`URL state: ${urlState || "defaults (all batches, period newest first; lines in template order)"}.`}</div>
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th className="py-2 pr-8 font-medium">Batch</th>
            <th className="py-2 pr-8 font-medium">Source</th>
            <th className="py-2 pr-8 font-medium">Scenario</th>
            <th className="py-2 font-medium">Open lines</th>
          </tr>
        </thead>
        <tbody>
          {data.batches.map(({ batch, open }) => (
            <tr key={batch.id} className="align-top">
              <td className="whitespace-nowrap py-2 pr-8">{batch.code}</td>
              <td className="py-2 pr-8">{batch.real ? "dev DB" : "stub"}</td>
              <td className="py-2 pr-8">{batch.scenario}</td>
              <td className="py-2">{open.length ? `${open.length}: ${Object.entries(Object.groupBy(open, (line) => line.state)).map(([state, lines]) => `${state} ${lines?.length}`).join(", ")}` : "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => prototypeActions.reset()} className="self-start underline underline-offset-4">Reset stub data</button>
    </div>
  );
}
