/**
 * PROTOTYPE, throwaway branch `prototype/emissions-variants`, never merged.
 *
 * Question: what should the Emissions area look like? It is where operators
 * add every emission line that a credit batch's Removal template asks for
 * (epic #1058 PR 3, plan docs/plans/2026-10-15-template-driven-emissions.md
 * §4.4).
 *
 * Plan: three structurally different variants of `/emissions` (overview) and
 * `/emissions/[creditBatchId]` (the batch's template lines), switchable via
 * `?variant=A|B|C` and the floating bottom bar.
 *   A "Checklist": batch list, then a Needs you / Done checklist page.
 *   B "Rail and tasks": batches as a persistent rail, open lines as tasks.
 *   C "Ledger": batches × states table, then a line ledger with inline add.
 *
 * Real: the shell, facility and credit batches (dev DB, read only). Stubbed in
 * memory: template lines, states and entries (prototype-emissions-data.ts).
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
import { SUBTITLE, VariantA } from "./prototype-variant-a";
import { VariantB } from "./prototype-variant-b";
import { VariantC } from "./prototype-variant-c";
import Link from "next/link";

const VARIANTS = [
  { key: "A", name: "Checklist" },
  { key: "B", name: "Rail and tasks" },
  { key: "C", name: "Ledger" },
] as const;

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
  } else if (variant.key === "B") body = <VariantB data={data} batchId={creditBatchId} />;
  else if (variant.key === "C") body = <VariantC data={data} batchId={creditBatchId} />;
  else body = <VariantA data={data} batchId={creditBatchId} />;

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

function StubState({ data, variant, route }: { data: ReturnType<typeof usePrototypeEmissions>; variant: string; route: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div>{`Variant ${variant} on ${route}. Last action: ${data.store.lastAction}. Store version ${data.store.version}.`}</div>
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
              <td className="py-2">{open.length ? open.map((line) => `${line.def.name} (${line.state})`).join("; ") : "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => prototypeActions.reset()} className="self-start underline underline-offset-4">Reset stub data</button>
    </div>
  );
}
