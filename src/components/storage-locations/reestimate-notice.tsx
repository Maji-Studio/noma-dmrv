"use client";

import { Button } from "@/components/ui/button";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { MassFlowSankey } from "@/components/ui/mass-flow-sankey";
import { Notice } from "@/components/ui/notice";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { AffectedStockPreview as Preview } from "@/types/output-stock";
import { reestimateFigures, reestimateFlow, type ReestimateFigures, type ReestimateKind } from "./reestimate-flow";

/** What the operator would re-measure, by the kind of draw. */
const MATERIAL: Record<ReestimateKind, string> = {
  loss: "the lost mass",
  delivery: "this delivery",
  correction: "the removed mass",
  biochar: "this biochar",
};

export const REESTIMATE_TITLE = "Wetter than the bin's estimate";
export const MEASURE_AGAIN_LABEL = "Edit the moisture";

/**
 * Focuses the first of these selectors that matches: the sub-bin row the
 * re-estimate affects, then the single moisture field, then a split draw's
 * first reading.
 */
export function focusMoistureField(selectors: string | readonly string[]) {
  const field = [selectors].flat().map((selector) => document.querySelector<HTMLInputElement>(selector)).find(Boolean);
  field?.scrollIntoView({ block: "center" });
  field?.focus();
}

/** The selectors a draw form's notice action tries, the affected sub-bin's row first. */
export function moistureFieldSelectors(idPrefix: string, singleFieldId: string, layerId?: string): string[] {
  return [...(layerId ? [`[id="${idPrefix}-moisture-${layerId}"]`] : []), `#${singleFieldId}`, `input[id^='${idPrefix}-moisture-']`];
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What saving re-estimates, and at which reading: the bin, or the sub-bins the draw reached. */
function savingSentence(figures: ReestimateFigures): string {
  const { moisturePercent, layers, wholeBin } = figures;
  const subject = wholeBin ? "what stays in the bin" : null;
  if (moisturePercent !== null) return `Saving re-estimates ${subject ?? listNames(layers.map((layer) => layer.name))} at ${formatMoisturePercent(moisturePercent)} moisture, until the next count.`;
  // Readings differ: each sub-bin at its own.
  return `Saving re-estimates ${listNames(layers.map((layer) => `${layer.name} at ${formatMoisturePercent(layer.moisturePercent)}`))}, until the next count.`;
}

/**
 * Shown when saving a draw re-estimates what stays (`preview.reestimate`): the
 * draw measured wetter than the bin's estimate, so the estimate would hold less
 * wet mass than solids. The notice says what saving does, offers the one action
 * that helps (go back to the moisture field of the affected sub-bin), and the
 * mass flow shows the consequence; the movement card above already holds the
 * before and after figures. Renders nothing otherwise.
 */
export function ReestimateNotice({ preview, kind, onMeasureAgain }: {
  preview: Preview;
  kind: ReestimateKind;
  /** Takes the operator to the moisture they entered, given the first affected sub-bin; without it the notice has no action. */
  onMeasureAgain?: (layerId?: string) => void;
}) {
  const figures = reestimateFigures(preview);
  if (!figures) return null;
  const doubt = figures.moisturePercent === null ? "a reading may be wrong" : `${formatMoisturePercent(figures.moisturePercent)} may be wrong`;
  return (
    <div data-testid="reestimate-notice" className="flex flex-col gap-16">
      <Notice
        tone="warning"
        title={REESTIMATE_TITLE}
        action={onMeasureAgain && <Button type="button" variant="weak" size="small" className="max-sm:min-h-44" onClick={() => onMeasureAgain(figures.wholeBin ? undefined : figures.layers[0]?.layerId)}>{MEASURE_AGAIN_LABEL}</Button>}
      >
        {savingSentence(figures)}{" "}
        If {doubt}, measure the moisture of {MATERIAL[kind]} again before saving.
        <ExplanationInfo title="Why the estimate changes" hint="A bin's moisture is an estimate. A draw measured wetter than it would leave less wet mass than the bin's solids, which cannot be. So until the next count, what stays is estimated at the draw's moisture.">
          <p className="body-caption text-[var(--color-text-secondary)]">Solids do not change with moisture, so the solids the draw takes are fixed. Only the water in what stays is re-estimated.</p>
        </ExplanationInfo>
      </Notice>
      <MassFlowSankey diagram={reestimateFlow(figures, preview.binName, kind)} />
    </div>
  );
}
