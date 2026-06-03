/**
 * EvidenceStep — step 3 of the removal Review flow. Absorbs the former
 * standalone Sources detail page: mirror chain-of-custody documents to
 * Isometric Sources, and publish reactor telemetry. Telemetry keeps its OWN
 * status block (its own dataUpload ledger + lifecycle, ADR 0006) — it is
 * deliberately not folded into the Removal's registry badge, and stays
 * lightweight while the pipeline is WIP.
 */
"use client";

import { SourcesPanel } from "../sources-panel";
import { TelemetryPanel } from "../telemetry-panel";

export function EvidenceStep({ removalId }: { removalId: string }) {
  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-8">
        <h2 className="title-heading-3">Evidence</h2>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          Mirror supporting documents from the chain-of-custody to Isometric
          Sources — they attach to every Datapoint at submit time — and publish
          the reactor telemetry that backs this Removal.
        </p>
      </div>

      <SourcesPanel removalId={removalId} />
      <TelemetryPanel removalId={removalId} />
    </div>
  );
}
