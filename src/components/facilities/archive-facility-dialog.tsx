/**
 * Archive Facility Dialog
 * Confirmation dialog for the cascading facility archive (soft delete).
 *
 * Loads an impact preview (child-record counts) and warns — without blocking —
 * when the facility has removals or GHG statements submitted to the certifier
 * registry. Archiving is reversible via Restore on the archived-facilities view.
 *
 * The dialog always names the target facility (code + name), and confirmation
 * scales with risk: an empty, unlinked facility archives on a single click,
 * while a facility with dependent records or registry submissions requires the
 * operator to type its code — a menu/context slip must not be able to hide an
 * entire populated site (QA 2026-07-21 F4).
 */
"use client";

import { useId, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, Modal } from "@/components/ui";
import { useFacilityArchiveImpact } from "@/hooks/use-facilities";

interface ArchiveFacilityDialogProps {
  /** Target facility; null closes the dialog. */
  facility: { id: string; code: string; name: string } | null;
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
  facility,
  onConfirm,
  onCancel,
  isPending = false,
}: ArchiveFacilityDialogProps) {
  const id = useId();
  const titleId = `${id}-archive-dialog-title`;
  const descId = `${id}-archive-dialog-desc`;
  const confirmInputId = `${id}-archive-dialog-confirm`;
  const [typedCode, setTypedCode] = useState("");

  const facilityId = facility?.id ?? null;
  const { data: impact, isLoading } = useFacilityArchiveImpact(facilityId);

  const impactParts = impact
    ? IMPACT_LABELS.filter(([key]) => impact[key] > 0).map(
        ([key, singular, plural]) =>
          `${impact[key]} ${impact[key] === 1 ? singular : plural}`
      )
    : [];
  const dependentRecordTotal = impact
    ? IMPACT_LABELS.reduce((sum, [key]) => sum + impact[key], 0)
    : 0;

  // Categories that were counted and came back empty. Listing them makes the
  // preview a complete ledger, so the operator can confirm every dependency
  // class (applications, lab samples, …) was evaluated — not silently omitted.
  const emptyParts = impact
    ? IMPACT_LABELS.filter(([key]) => impact[key] === 0).map(
        ([, , plural]) => plural
      )
    : [];

  // Risk-proportional confirmation: dependent data or registry-submitted
  // lineage requires typing the facility code; an empty facility does not.
  const requiresTypedCode =
    !!impact && (dependentRecordTotal > 0 || impact.hasRegistrySubmissions);
  const typedCodeMatches =
    !requiresTypedCode ||
    typedCode.trim().toLowerCase() === (facility?.code ?? "").toLowerCase();

  const handleCancel = () => {
    setTypedCode("");
    onCancel();
  };

  return (
    <Modal
      isOpen={!!facility}
      onClose={handleCancel}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descId}
      width="sm"
    >
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <h2 id={titleId} className="title-heading-3">
            Archive facility {facility?.code}
          </h2>
          <p
            id={descId}
            className="body-medium text-[var(--color-text-secondary)]"
          >
            Archiving{" "}
            <span className="font-medium text-[var(--color-text-primary)]">
              {facility?.code} — {facility?.name}
            </span>{" "}
            hides it and all of its data from lists, pickers, and stats across
            the app. Nothing is deleted — you can restore it any time from the
            archived view.
          </p>

          {isLoading ? (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Checking attached data…
            </p>
          ) : impactParts.length > 0 ? (
            <div className="flex flex-col gap-4">
              <p className="body-small text-[var(--color-text-secondary)]">
                Also archives {dependentRecordTotal} dependent{" "}
                {dependentRecordTotal === 1 ? "record" : "records"}:{" "}
                {impactParts.join(", ")}.
              </p>
              {emptyParts.length > 0 && (
                <p className="body-small text-[var(--color-text-tertiary)]">
                  Checked, none found: {emptyParts.join(", ")}.
                </p>
              )}
            </div>
          ) : impact ? (
            <div className="flex flex-col gap-4">
              <p className="body-small text-[var(--color-text-tertiary)]">
                This facility has no attached data.
              </p>
              {emptyParts.length > 0 && (
                <p className="body-small text-[var(--color-text-tertiary)]">
                  Checked, none found: {emptyParts.join(", ")}.
                </p>
              )}
            </div>
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

          {requiresTypedCode && (
            <div className="flex flex-col gap-8">
              <label
                htmlFor={confirmInputId}
                className="body-small text-[var(--color-text-secondary)]"
              >
                Type <span className="font-mono font-medium text-[var(--color-text-primary)]">{facility?.code}</span> to
                confirm archiving this facility and its data.
              </label>
              <input
                id={confirmInputId}
                type="text"
                value={typedCode}
                onChange={(event) => setTypedCode(event.target.value)}
                placeholder={facility?.code}
                autoComplete="off"
                className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 font-mono body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              />
            </div>
          )}
        </div>

        <div className="flex gap-16 justify-end">
          <Button
            size="large"
            variant="default"
            onClick={handleCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant="default"
            onClick={() => {
              setTypedCode("");
              onConfirm();
            }}
            disabled={isPending || isLoading || !impact || !typedCodeMatches}
          >
            {isPending ? "Archiving..." : "Archive"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
