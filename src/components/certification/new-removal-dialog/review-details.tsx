/**
 * The details view of Review & submit: everything the Removal sends, one view
 * that replaces the summary. The credit batches and the component table, the
 * emissions carried from other credit batches, the production runs and
 * applications behind it, and the technical details for support.
 *
 * Production runs carry no credit batch in the ledger, so the records stay in
 * one fold below the table instead of one fold per credit batch.
 */
"use client";

import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import type { RemovalCompilationView } from "@/fn/certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { isometricRegistry } from "@/lib/isometric/links";
import { cn } from "@/lib/utils";
import { CarriedEntriesPanel } from "../carried-entries";
import { ComponentTable } from "./component-table";
import type { ComponentTable as ComponentTableModel } from "./component-table-model";
import { DebugDrawer } from "./debug-drawer";
import { PassedChecks } from "./review-parts";
import { SourceRecords } from "./source-records";
import type { SubmissionFacts } from "./submission-facts";

/** "1000-year (R₀ reflectance)" becomes the tier and the method in its brackets, if any. */
function durabilityParts(label: string): { tier: string; method: string | null } {
  const match = /^(.*?)\s*\((.+)\)$/.exec(label);
  return match ? { tier: match[1], method: match[2] } : { tier: label, method: null };
}

/** "1000-year durability · Sampled credit batches"; the method sits behind the (i). */
function FactsLine({ facts }: { facts: Pick<SubmissionFacts, "durabilityLabel" | "samplingLabel"> }) {
  const { tier, method } = durabilityParts(facts.durabilityLabel);
  const durability = `${tier} durability`;
  return (
    <p className="flex flex-col gap-2 body-small text-[var(--color-text-secondary)] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-6">
      <span>
        {durability}
        {method && <ExplanationInfo title={durability} hint={`Measured by ${method}.`} />}
      </span>
      <span aria-hidden className="max-sm:hidden">
        ·
      </span>
      <span>{facts.samplingLabel} credit batches</span>
    </p>
  );
}

export function ReviewDetails({
  ctx,
  facilityId,
  facts,
  table,
  compilation,
  isCompilationLoading,
  compilationError,
  passedChecks,
  onBack,
  onRetryCompilation,
}: {
  ctx: RemovalCertifyContext;
  facilityId: string;
  facts: SubmissionFacts;
  table: ComponentTableModel;
  compilation: RemovalCompilationView | null;
  isCompilationLoading: boolean;
  compilationError: Error | null;
  /** Labels of the checks that passed, behind "N checks passed". */
  passedChecks: readonly string[];
  onBack: () => void;
  onRetryCompilation: () => void;
}) {
  const externalProjectId = ctx.mapping?.externalProjectId ?? null;
  return (
    <div className="flex flex-col gap-24">
      <div className="-my-8 flex flex-col">
        <Button variant="noOutline" className={cn("self-start", PHONE_TOUCH_TARGET)} onClick={onBack}>
          <CaretLeftIcon size={16} aria-hidden />
          Back to summary
        </Button>
      </div>
      <FactsLine facts={facts} />
      <PassedChecks checks={passedChecks} />
      <ComponentTable table={table} facilityId={facilityId} />
      <CarriedEntriesPanel entries={ctx.carriedEntries} facilityId={facilityId} />
      <SourceRecords
        ledger={ctx.emissionsLedger}
        facilityId={facilityId}
        storageSitesHref={
          externalProjectId
            ? isometricRegistry.storageSites({
                environment: ctx.isProduction ? "production" : "sandbox",
                externalProjectId,
              })
            : null
        }
      />
      <DebugDrawer
        compilation={compilation}
        isCompilationLoading={isCompilationLoading}
        compilationError={compilationError}
        onRetryCompilation={onRetryCompilation}
      />
    </div>
  );
}
