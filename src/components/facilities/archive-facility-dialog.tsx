/**
 * Archive Facility Dialog
 * Confirmation dialog for the cascading facility archive (soft delete).
 *
 * Loads an impact preview (child-record counts) and warns — without blocking —
 * when the facility has removals or GHG statements submitted to the certifier
 * registry. Archiving is reversible via Restore on the archived-facilities view.
 */
"use client";

import { useId } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { Button, Modal } from "@/components/ui";
import { useFacilityArchiveImpact } from "@/hooks/use-facilities";

interface ArchiveFacilityDialogProps {
  facilityId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

const IMPACT_LABELS = [
  ["reactorCount", "reactor", "reactors"],
  ["storageLocationCount", "storage bin", "storage bins"],
  ["feedstockDeliveryCount", "feedstock delivery", "feedstock deliveries"],
  ["feedstockCount", "feedstock batch", "feedstock batches"],
  ["productionRunCount", "production run", "production runs"],
  ["biocharProductCount", "biochar product", "biochar products"],
  ["orderCount", "order", "orders"],
  ["deliveryCount", "delivery", "deliveries"],
  ["applicationCount", "application", "applications"],
  ["creditBatchCount", "credit batch", "credit batches"],
  ["sampleCount", "lab sample", "lab samples"],
  ["stockpileEventCount", "stockpile event", "stockpile events"],
  ["powerProcurementEvidenceCount", "power procurement record", "power procurement records"],
] as const;

export function ArchiveFacilityDialog({
  facilityId,
  onConfirm,
  onCancel,
  isPending = false,
}: ArchiveFacilityDialogProps) {
  const id = useId();
  const titleId = `${id}-archive-dialog-title`;
  const descId = `${id}-archive-dialog-desc`;

  const { data: impact, isLoading } = useFacilityArchiveImpact(facilityId);

  const impactParts = impact
    ? IMPACT_LABELS.filter(([key]) => impact[key] > 0).map(
        ([key, singular, plural]) =>
          `${impact[key]} ${impact[key] === 1 ? singular : plural}`
      )
    : [];

  // Categories that were counted and came back empty. Listing them makes the
  // preview a complete ledger, so the operator can confirm every dependency
  // class (applications, lab samples, …) was evaluated — not silently omitted.
  const emptyParts = impact
    ? IMPACT_LABELS.filter(([key]) => impact[key] === 0).map(
        ([, , plural]) => plural
      )
    : [];

  return (
    <Modal
      isOpen={!!facilityId}
      onClose={onCancel}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descId}
      width="sm"
    >
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <h2 id={titleId} className="title-heading-3">
            Archive Facility
          </h2>
          <p
            id={descId}
            className="body-medium text-[var(--color-text-secondary)]"
          >
            Archiving hides this facility and all of its data from lists,
            pickers, and stats across the app. Nothing is deleted — you can
            restore it any time from the archived view.
          </p>

          {isLoading ? (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Checking attached data…
            </p>
          ) : impactParts.length > 0 ? (
            <div className="flex flex-col gap-4">
              <p className="body-small text-[var(--color-text-secondary)]">
                Also archives: {impactParts.join(", ")}.
              </p>
              {emptyParts.length > 0 && (
                <p className="body-small text-[var(--color-text-tertiary)]">
                  Checked, none found: {emptyParts.join(", ")}.
                </p>
              )}
            </div>
          ) : impact ? (
            <p className="body-small text-[var(--color-text-tertiary)]">
              This facility has no attached data.
            </p>
          ) : (
            <p className="body-small text-[var(--color-signal-red)]">
              Couldn&apos;t load the impact preview — archiving is disabled.
              Close the dialog and try again.
            </p>
          )}

          {impact?.hasRegistrySubmissions && (
            <div className="flex items-start gap-8 border border-[var(--clr-orange-20)] bg-[var(--clr-orange-10)] p-12">
              <WarningIcon
                size={18}
                weight="bold"
                className="mt-2 shrink-0 text-[var(--clr-orange)]"
              />
              <p className="body-small text-[var(--color-text-primary)]">
                This facility has removals or GHG statements submitted to the
                certifier registry. Archiving hides them here but does not
                change anything on the registry.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-16 justify-end">
          <Button
            size="large"
            variant="default"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant="default"
            onClick={onConfirm}
            disabled={isPending || isLoading || !impact}
          >
            {isPending ? "Archiving..." : "Archive"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
