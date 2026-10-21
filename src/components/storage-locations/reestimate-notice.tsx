"use client";

import { Button } from "@/components/ui/button";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { MassFlowSankey } from "@/components/ui/mass-flow-sankey";
import { Notice } from "@/components/ui/notice";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { AffectedStockPreview as Preview } from "@/types/output-stock";
import type { StockEntryKind } from "./output-stock-preview";
import { reestimateFigures, reestimateFlow } from "./reestimate-flow";

/** What the operator would re-measure, by the kind of movement. */
const MATERIAL: Record<Exclude<StockEntryKind, "count">, string> = {
  loss: "the lost mass",
  delivery: "this delivery",
  correction: "the removed mass",
};

export const REESTIMATE_TITLE = "Wetter than the bin's estimate";
export const MEASURE_AGAIN_LABEL = "Edit the moisture";

/** A moisture field the notice's action can focus: the single field, or a split draw's first reading. */
export function focusMoistureField(selector: string) {
  const field = document.querySelector<HTMLInputElement>(selector);
  field?.scrollIntoView({ block: "center" });
  field?.focus();
}

/**
 * Shown when saving a removal re-estimates what stays (`preview.reestimate`):
 * the removal measured wetter than the bin's estimate, so the estimate would
 * hold less wet mass than dry biochar. The notice says what saving does, offers
 * the one action that helps (go back to the moisture field), and the mass flow
 * shows the consequence; the movement card above already holds the before and
 * after figures. Renders nothing otherwise.
 */
export function ReestimateNotice({ preview, kind, onMeasureAgain }: {
  preview: Preview;
  kind: Exclude<StockEntryKind, "count">;
  /** Takes the operator to the moisture they entered; without it the notice has no action. */
  onMeasureAgain?: () => void;
}) {
  const figures = reestimateFigures(preview);
  if (!figures) return null;
  const moisture = formatMoisturePercent(figures.moisturePercent);
  return (
    <div data-testid="reestimate-notice" className="flex flex-col gap-16">
      <Notice
        tone="warning"
        title={REESTIMATE_TITLE}
        action={onMeasureAgain && <Button type="button" variant="weak" size="small" onClick={onMeasureAgain}>{MEASURE_AGAIN_LABEL}</Button>}
      >
        Saving re-estimates what stays in the bin at {moisture} moisture, until the next count.{" "}
        If {moisture} may be wrong, measure the moisture of {MATERIAL[kind]} again before saving.
        <ExplanationInfo title="Wetter than the estimate" hint="A bin's moisture is an estimate. A removal measured wetter than it would leave less wet mass than dry biochar, which cannot be. So until the next count, what stays is estimated at the removal's moisture.">
          <p className="body-caption text-[var(--color-text-secondary)]">Dry biochar does not change with moisture, so the dry figure is what the removal takes. Only the water in what stays is re-estimated.</p>
        </ExplanationInfo>
      </Notice>
      <MassFlowSankey diagram={reestimateFlow(figures, preview.binName, kind)} />
    </div>
  );
}
