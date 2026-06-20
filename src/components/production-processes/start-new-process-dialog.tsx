/**
 * StartNewProcessDialog — the deliberate, human-confirmed baseline reset for a
 * (facility, feedstock) pair (ADR 0017 Track 2, item 7 / D6).
 *
 * Starting a new production process opens a fresh Method-A campaign whose
 * baseline restarts from zero. It is the ONLY remedy noma offers for drift — it
 * is never auto-invoked. The prior process keeps its history but stops receiving
 * new batches. An optional note records why (feedstock change, condition change,
 * sustained carbon deviation).
 */
"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useStartNewProductionProcess } from "@/hooks/use-production-processes";
import type { ProductionProcessSummary } from "@/data-access/production-processes";

const TITLE_ID = "start-new-process-title";
const NOTES_MAX = 2000;

interface StartNewProcessDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The current process being superseded. Null while no row is selected. */
  process: ProductionProcessSummary | null;
}

export function StartNewProcessDialog({
  isOpen,
  onClose,
  process,
}: StartNewProcessDialogProps) {
  const toast = useToast();
  const startNew = useStartNewProductionProcess();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNotes("");
    setError(null);
  };

  const handleConfirm = async () => {
    if (!process) return;
    setError(null);
    try {
      await startNew.mutateAsync({
        facilityId: process.facilityId,
        feedstockTypeId: process.feedstockTypeId,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Started a new production process");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start a new process",
      );
    }
  };

  const isMethodB = process?.samplingMethod === "method_b";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={reset}
      ariaLabelledBy={TITLE_ID}
      width="sm"
      dismissOnClickOutside={false}
    >
      <div className="flex flex-col gap-20">
        <div className="flex flex-col gap-12">
          <h2 id={TITLE_ID} className="title-heading-3">
            Start a new production process
          </h2>
          <div className="body-medium text-[var(--color-text-secondary)]">
            {process ? (
              <p>
                A fresh Method-A campaign begins for{" "}
                <strong className="body-medium-bold">
                  {process.feedstockName} ({process.feedstockCode})
                </strong>
                . Its baseline restarts from zero
                {isMethodB ? ", ending the current Method-B regime" : ""}. The
                current process keeps its history but stops receiving new batches.
              </p>
            ) : (
              <p>Begin a fresh Method-A campaign for this feedstock.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <label
            htmlFor="start-new-process-notes"
            className="body-small font-medium text-[var(--color-text-secondary)]"
          >
            Reason (optional)
          </label>
          <textarea
            id="start-new-process-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={NOTES_MAX}
            rows={3}
            placeholder="e.g. feedstock supplier changed; pyrolysis conditions retuned"
            className="w-full border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-8 text-[var(--color-text-primary)] text-[var(--text-s)] transition-all focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)] rounded-none"
          />
        </div>

        {error && <ServerError message={error} />}

        <div className="flex justify-end gap-12">
          <Button
            size="large"
            variant="default"
            onClick={onClose}
            disabled={startNew.isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant="primary"
            onClick={handleConfirm}
            busy={startNew.isPending}
          >
            {startNew.isPending ? "Starting…" : "Start new process"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
