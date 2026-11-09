/**
 * The details view of Review & submit: everything the Removal sends, one view
 * that replaces the summary. The credit batches and the component table, the
 * emissions carried from other credit batches, the records behind it, and the
 * technical details for support.
 *
 * The records sit under each credit batch, as on the Removal sheet.
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

/** What the durability reads as: one tier with its method behind the (i), or "Mixed durability" with every tier behind it. */
export function durabilityParts(tiers: readonly string[]): { text: string; hint: string } {
  if (tiers.length !== 1) return { text: "Mixed durability", hint: tiers.join(", ") };
  const match = /^(.*?)\s*\((.+)\)$/.exec(tiers[0]);
  return match ? { text: `${match[1]} durability`, hint: `Measured by ${match[2]}.` } : { text: `${tiers[0]} durability`, hint: "" };
}

/** "1000-year durability · Sampled credit batches"; the method (or each tier of a mix) sits behind the (i). */
export function FactsLine({ facts }: { facts: Pick<SubmissionFacts, "durabilityTiers" | "samplingLabel"> }) {
  const { text, hint } = durabilityParts(facts.durabilityTiers);
  return (
    <p className="flex flex-col gap-2 body-small text-[var(--color-text-secondary)] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-6">
      <span>
        {text}
        {/* The trigger is a 24px box; pull its trailing space in so the separator sits close to the glyph. */}
        {hint && <ExplanationInfo title={text} hint={hint} className="sm:-mr-6" />}
      </span>
      <span aria-hidden className="max-sm:hidden">
        ·
      </span>
      <span>{facts.samplingLabel}</span>
    </p>
  );
}

export function ReviewDetails({
  ctx,
  facilityId,
  removalId,
  facts,
  table,
  compilation,
  isCompilationLoading,
  compilationError,
  passedChecks,
  onBack,
  onFix,
  onRetryCompilation,
}: {
  ctx: RemovalCertifyContext;
  facilityId: string;
  removalId: string;
  facts: SubmissionFacts;
  table: ComponentTableModel;
  compilation: RemovalCompilationView | null;
  isCompilationLoading: boolean;
  compilationError: Error | null;
  /** Labels of the checks that passed, behind "N checks passed". */
  passedChecks: readonly string[];
  onBack: () => void;
  /** A repair link was used: the review is read again when the operator returns. */
  onFix?: () => void;
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
      <ComponentTable table={table} facilityId={facilityId} onFix={onFix} />
      <CarriedEntriesPanel entries={ctx.carriedEntries} facilityId={facilityId} />
      <SourceRecords
        removalId={removalId}
        onFix={onFix}
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
