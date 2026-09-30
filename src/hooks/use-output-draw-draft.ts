"use client";

import type { OutputStockPreviewInput } from "@/types/output-stock";
import { useOutputMoistureEstimate } from "./use-output-moisture-estimate";
import { useOutputStockPreview } from "./use-output-stock";
import type { useSubBinDraw } from "./use-sub-bin-draw";

type Sources = NonNullable<OutputStockPreviewInput["sources"]>;

interface OutputDrawDraftOptions {
  draw: ReturnType<typeof useSubBinDraw>;
  /** The form's single-moisture reading is usable; only read when the draw is not split. */
  singleMoistureReady: boolean;
  /**
   * The preview input once the form's own fields are complete, or null.
   * Called only when the readings are ready; `sources` is set exactly when the
   * draw is split, so the form spreads `sources` or its single moisture.
   */
  buildInput: (sources: Sources | null) => OutputStockPreviewInput | null;
  /** Bin, facility and time for the moisture field's estimate; null when the field has none. */
  estimateFor: { storageLocationId: string; facilityId: string | null | undefined; occurredAt: string | null | undefined } | null;
  /** The form saves without a preview (an edit of a saved entry). */
  bypass?: boolean;
}

/**
 * The stock-draw half every output form shares: the readings gate, the
 * preview, the moisture estimate, and the one save gate. The submit guard and
 * the button both read `gate()`, so they cannot drift apart. A failed or
 * refetching preview keeps its last data, so the gate also checks `isFetching`
 * and `error`. Recovery after a failed save belongs to the mutation hooks,
 * which invalidate `outputStockKeys.all`.
 *
 * `readingsReady` is returned so a form can gate a second preview on the same
 * readings; that preview is created after this hook, so its unavailability
 * enters the gate as `gate(extraUnavailable)`.
 */
export function useOutputDrawDraft({ draw, singleMoistureReady, buildInput, estimateFor, bypass = false }: OutputDrawDraftOptions) {
  const readingsReady = draw.active ? draw.sources !== null : draw.usesSingleMoisture && singleMoistureReady;
  // Save stays pressable while a reached row is empty, so pressing it names the missing reading.
  const awaitingReadings = draw.active && draw.sources === null && !draw.untickCode && !draw.needsTick;
  const input = readingsReady ? buildInput(draw.active ? draw.sources : null) : null;
  const preview = useOutputStockPreview(input);
  const estimate = useOutputMoistureEstimate(draw.active || !estimateFor ? null : estimateFor.storageLocationId, estimateFor?.facilityId, estimateFor?.occurredAt, preview.data?.moistureEstimate);
  const previewReady = !!input && !!preview.data && !preview.isFetching && !preview.error && !preview.data.blockingMessage;
  /** `extraUnavailable`: another preview the save also waits on is missing, fetching, failed or blocked. */
  function gate(extraUnavailable = false) {
    const canSave = bypass || (previewReady && !extraUnavailable);
    // The button stays pressable while a reached row is empty, so pressing it names the missing reading.
    return { canSave, submitDisabled: !canSave && !awaitingReadings };
  }
  return { preview, input, estimate, readingsReady, gate, basisFingerprint: preview.data?.basisFingerprint };
}
