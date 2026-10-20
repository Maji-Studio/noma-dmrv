/**
 * SelectBatchesStep, step 1 of the New-Removal wizard. One compact box per
 * credit batch (#1202): ready batches lead and can be selected; a batch that is
 * not ready shows one status line and links to its open to-dos on the batch page,
 * where every open item is listed and fixed. The selection step never repeats
 * that list.
 *
 * When facility setup is incomplete a banner blocks grouping for the whole
 * facility; there's no registry to submit to without it (§8).
 */
"use client";

import Link from "next/link";
import { formatUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import { certificationRemovalTemplatesHref, certificationSettingsHref, DECIDE_LINES_LINK_LABEL, OPEN_REMOVAL_TEMPLATES_LINK_LABEL } from "@/lib/certification/links";
import {
  facilityBlueprintLabel,
  type FacilitySetupGap,
} from "@/lib/certification/facility-setup-gaps";
import type { SelectableBatch } from "@/fn/certification";
import { Notice } from "@/components/ui/notice";
import { NotReadyBatchBox, ReadyBatchBox } from "./batch-box";

interface SelectBatchesStepProps {
  batches: SelectableBatch[];
  facilitySetupGaps: FacilitySetupGap[];
  facilityId: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Plain-language copy for one structured setup gap: what exactly is unmet and
 * where it is fixed. Only the gaps that ARE about the project link / template
 * send the operator to certification settings — an unresolved blueprint on an
 * already-linked facility names the blueprint keys instead of issuing a false
 * "link this facility" instruction (QA 2026-07-21 F2).
 */
export function setupGapCopy(gap: FacilitySetupGap): {
  message: string;
  lines?: string[];
  /** Certifier for the project link, Removal templates for anything about the template. */
  action: { label: string; target: "certifier" | "removalTemplates" } | null;
} {
  switch (gap.kind) {
    case "project_link":
      return {
        message:
          "This facility isn't linked to an Isometric project yet. Link it before grouping batches.",
        action: { label: "Link facility in certification settings", target: "certifier" },
      };
    case "external_facility_id":
      return {
        message: "This facility is linked, but its Isometric facility ID is not set.",
        action: { label: "Set Isometric facility ID in certification settings", target: "certifier" },
      };
    case "credentials":
      return {
        message:
          "The organization's registry connection credentials are not set, so the registry cannot be reached. Ask an Owner or Admin to add them before linking this facility.",
        action: null,
      };
    case "default_template":
      return {
        message:
          "This facility is linked, but no default Removal template is set for it.",
        action: { label: "Choose a default in Removal templates", target: "removalTemplates" },
      };
    case "template_resolution":
      return {
        message: `The default Removal template (${gap.templateId}) is no longer available in the registry. Choose another default.`,
        action: { label: "Choose a default in Removal templates", target: "removalTemplates" },
      };
    case "template_unbindable": {
      const { lead, lines } = formatUnbindableTemplateInputs(gap.inputs);
      const toDecide = gap.inputs.some((input) => input.reason === "unassigned" || input.reason === "ambiguous");
      return {
        message: lead,
        lines,
        action: { label: toDecide ? DECIDE_LINES_LINK_LABEL : OPEN_REMOVAL_TEMPLATES_LINK_LABEL, target: "removalTemplates" },
      };
    }
    case "blueprint_keys": {
      const labels = gap.keys.map(facilityBlueprintLabel);
      return {
        message:
          `The selected Removal template uses ${gap.keys.length} ` +
          `${gap.keys.length === 1 ? "component" : "components"} the registry cannot load: ` +
          `${labels.join(", ")}. Choose another default in Removal templates.`,
        action: { label: OPEN_REMOVAL_TEMPLATES_LINK_LABEL, target: "removalTemplates" },
      };
    }
  }
}

export function SelectBatchesStep({
  batches,
  facilitySetupGaps,
  facilityId,
  selectedIds,
  onToggle,
  isLoading,
  isError,
}: SelectBatchesStepProps) {
  const readyBatches = batches.filter((b) => b.health.state === "ready");
  const notReadyBatches = batches.filter((b) => b.health.state !== "ready");
  const hasBatches = batches.length > 0;
  const is1000YearFacility = batches.some(
    (batch) => batch.durabilityOption === "1000_year",
  );
  const hasSelectedBatch = selectedIds.size > 0;

  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-3 flex items-center gap-6">
        Select credit batches
        <InfoHint>
          Only batches whose data is complete can be grouped into a Removal.
        </InfoHint>
      </h3>

      {is1000YearFacility && (
        <p className="body-small text-[var(--color-text-secondary)]">
          Select one credit batch. Each 1000-year credit batch needs a separate
          Removal.
        </p>
      )}

      {/* Setup gaps render only once the readiness query has settled — a
          loading default must not flash a false "finish setup" instruction. */}
      {!isLoading &&
        facilitySetupGaps.map((gap) => {
          const copy = setupGapCopy(gap);
          return (
            <Notice
              key={gap.kind}
              tone={gap.kind === "template_unbindable" ? "error" : "warning"}
              action={
                copy.action && (
                  <Link
                    href={copy.action.target === "removalTemplates" ? certificationRemovalTemplatesHref(facilityId) : certificationSettingsHref(facilityId)}
                    className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
                  >
                    {copy.action.label}
                    <ArrowSquareOutIcon size={12} aria-hidden />
                  </Link>
                )
              }
            >
              {copy.message}
              {copy.lines && (
                <ul className="list-disc pl-16">
                  {copy.lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
            </Notice>
          );
        })}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading credit batches…
        </p>
      ) : isError ? (
        <p className="body-small text-[var(--color-signal-red)]" role="alert">
          Couldn&apos;t load credit batches. Try again.
        </p>
      ) : !hasBatches ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No ungrouped credit batches in this facility.
        </p>
      ) : (
        // One compact box per batch (#1202): ready batches first, then the
        // ones still open, each pointing at its open to-dos on the batch page.
        <ul className="flex flex-col gap-8" aria-label="Credit batches">
          {readyBatches.map((batch) => (
            <ReadyBatchBox
              key={batch.id}
              batch={batch}
              facilityId={facilityId}
              selected={selectedIds.has(batch.id)}
              disabled={
                is1000YearFacility &&
                hasSelectedBatch &&
                !selectedIds.has(batch.id)
              }
              onToggle={onToggle}
            />
          ))}
          {notReadyBatches.map((batch) => (
            <NotReadyBatchBox key={batch.id} batch={batch} facilityId={facilityId} />
          ))}
        </ul>
      )}
    </div>
  );
}
