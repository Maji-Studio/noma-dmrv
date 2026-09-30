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
  /** The entry's own fields once complete, or null. The hook adds the readings. */
  entry: Omit<OutputStockPreviewInput, "sources" | "moisturePercent"> | null;
  /** The single moisture reading, sent when the draw is not split. */
  moisturePercent?: number | null;
  /**
   * What the moisture field's estimate reads. A null bin skips the bin balance
   * but keeps the facility, so a preview's own estimate is still shown on the
   * facility clock.
   */
  estimateFor: { storageLocationId: string | null | undefined; facilityId: string | null | undefined; occurredAt: string | null | undefined };
  /** Saves without a preview (an edit of a saved entry): no input, no estimate, always savable. */
  bypass?: boolean;
  /** Writes the draw's readings into the form just before its submit runs; `split` is true for a split draw. */
  writeReadings: (sources: Sources | undefined, split: boolean) => void;
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
 * readings; that preview is created after this hook, so it enters the gate as
 * `gate({ unavailable, basisFingerprint })` and its basis wins.
 */
export function useOutputDrawDraft({ draw, singleMoistureReady, entry, moisturePercent, estimateFor, bypass = false, writeReadings }: OutputDrawDraftOptions) {
  const readingsReady = draw.active ? draw.sources !== null : draw.usesSingleMoisture && singleMoistureReady;
  // Save stays pressable while a reached row is empty, so pressing it names the missing reading.
  const awaitingReadings = draw.active && draw.sources === null && !draw.untickCode && !draw.needsTick;
  const readings = draw.active ? { sources: draw.sources ?? undefined } : { moisturePercent };
  const input = !bypass && readingsReady && entry ? { ...entry, ...readings } : null;
  const preview = useOutputStockPreview(input);
  const estimate = useOutputMoistureEstimate(bypass || draw.active ? null : estimateFor.storageLocationId, estimateFor.facilityId, estimateFor.occurredAt, preview.data?.moistureEstimate);
  const previewReady = !!input && !!preview.data && !preview.isFetching && !preview.error && !preview.data.blockingMessage;
  /** `extra`: another preview the save also waits on, and the basis it saves against. */
  function gate(extra?: { unavailable: boolean; basisFingerprint?: string }) {
    const canSave = bypass || (previewReady && !extra?.unavailable);
    return {
      canSave,
      // The button stays pressable while a reached row is empty, so pressing it names the missing reading.
      submitDisabled: !canSave && !awaitingReadings,
      basisFingerprint: extra?.basisFingerprint ?? preview.data?.basisFingerprint,
    };
  }
  function beginSubmit() {
    writeReadings(draw.active ? draw.sources ?? undefined : undefined, draw.active);
  }
  return { preview, input, estimate, readingsReady, gate, beginSubmit };
}
