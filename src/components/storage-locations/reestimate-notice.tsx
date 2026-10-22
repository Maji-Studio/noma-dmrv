"use client";

import { Button } from "@/components/ui/button";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { MassFlowSankey } from "@/components/ui/mass-flow-sankey";
import { Notice } from "@/components/ui/notice";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { AffectedStockPreview as Preview } from "@/types/output-stock";
import { LedgerBeforeAfter } from "./stock-ledger";
import { moistureOf, reestimateFigures, reestimateFlow, type ReestimateFigures, type ReestimateKind } from "./reestimate-flow";

/** Who takes the biochar out, as the subject of the explanation's sentences. */
const SUBJECT: Record<ReestimateKind, string> = {
  loss: "The lost mass",
  delivery: "This delivery",
  correction: "The removed mass",
  biochar: "This product",
};

export const MEASURE_AGAIN_LABEL = "Edit the moisture";

/**
 * Focuses the first of these selectors that matches: the sub-bin row the
 * draw affects, then the single moisture field, then a split draw's
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

/** Wide enough for the flow diagram on desktop (the panel keeps a 16px gutter on a phone); tall enough that it does not scroll. */
const FLOW_PANEL_CLASS = "w-[min(640px,calc(100vw-32px))] max-h-[min(640px,var(--available-height))]";
const AFTER_SAVING_LABEL = "After saving";

interface NoticeCopy {
  title: string;
  body: string;
  whyTitle: string;
  why: string;
  /** Before and after, one pair for the bin or one per sub-bin. */
  pairs: { key: string; beforeLabel: string; before: string; after: string }[];
}

/** "400 kg at 20%". */
function massAt(wetKg: number, moisturePercent: number): string {
  return `${formatMassKg(wetKg)} at ${formatMoisturePercent(moisturePercent)}`;
}

/**
 * The notice in the operator's words. The whole bin at one reading is named
 * as the bin; otherwise the sub-bins the draw reached are named, with one
 * before and after pair each.
 */
function noticeCopy(figures: ReestimateFigures, kind: ReestimateKind): NoticeCopy {
  const { moisturePercent, layers, wholeBin } = figures;
  const reading = moisturePercent === null ? null : formatMoisturePercent(moisturePercent);
  const names = listNames(layers.map((layer) => layer.name));
  const subject = SUBJECT[kind];
  const solids = figures.allBiochar ? "biochar" : "dry solids";
  if (wholeBin && moisturePercent !== null && reading) {
    return {
      title: `Check the moisture: ${reading} against the bin's ${formatMoisturePercent(moistureOf(figures.binWetKg, figures.binSolidsKg))}`,
      body: `If ${reading} is right, saving changes the bin until it is counted again.`,
      whyTitle: "Why the bin goes up",
      why: `${formatMassKg(figures.binSolidsKg)} of the bin is ${solids}. ${subject} takes ${formatMassKg(figures.removedSolidsKg)} of it, so ${formatMassKg(figures.staySolidsKg)} stays. Counted at ${reading} moisture, those ${formatMassKg(figures.staySolidsKg)} weigh ${formatMassKg(figures.stayWetKg)}.`,
      pairs: [{ key: "bin", beforeLabel: "Bin now", before: massAt(figures.binWetKg, moistureOf(figures.binWetKg, figures.binSolidsKg)), after: massAt(figures.stayWetKg, moisturePercent) }],
    };
  }
  const pairs = layers.flatMap((layer) => layer.beforeWetKg === null || layer.beforeMoisturePercent === null ? [] : [{
    key: layer.layerId, beforeLabel: `${layer.name} now`, before: massAt(layer.beforeWetKg, layer.beforeMoisturePercent), after: massAt(layer.stayWetKg, layer.moisturePercent),
  }]);
  const staySolidsKg = layers.reduce((sum, layer) => sum + layer.staySolidsKg, 0);
  const stayWetKg = layers.reduce((sum, layer) => sum + layer.stayWetKg, 0);
  const at = reading ? `${reading} moisture` : "the moisture entered for each";
  const first = layers[0];
  const title = reading === null ? "Check the moisture readings"
    : layers.length === 1 && first?.beforeMoisturePercent != null ? `Check the moisture: ${reading} against ${first.name}'s ${formatMoisturePercent(first.beforeMoisturePercent)}`
      : `Check the moisture: ${reading} for ${names}`;
  return {
    title,
    body: `If ${reading ?? "these readings are"}${reading ? " is" : ""} right, saving changes ${names} until the bin is counted again.`,
    whyTitle: layers.length === 1 ? `Why ${names} goes up` : `Why ${names} go up`,
    why: `${subject} takes its ${solids} from the bin. The ${formatMassKg(staySolidsKg)} of ${solids} that stays in ${names}, counted at ${at}, weigh${layers.length === 1 ? "s" : ""} ${formatMassKg(stayWetKg)}.`,
    pairs,
  };
}

/**
 * Shown when saving a draw changes what stays (`preview.reestimate`): the draw
 * measured wetter than the bin, so the bin would hold less wet mass than
 * biochar. The notice asks to check the moisture, shows the bin before and
 * after saving, offers the one action that helps (go back to the moisture
 * field of the affected sub-bin), and the mass flow opens from the (i).
 * Renders nothing otherwise.
 */
export function ReestimateNotice({ preview, kind, onMeasureAgain }: {
  preview: Preview;
  kind: ReestimateKind;
  /** Takes the operator to the moisture they entered, given the first affected sub-bin; without it the notice has no action. */
  onMeasureAgain?: (layerId?: string) => void;
}) {
  const figures = reestimateFigures(preview);
  if (!figures) return null;
  const copy = noticeCopy(figures, kind);
  return (
    <div data-testid="reestimate-notice" className="flex flex-col gap-16">
      <Notice
        tone="warning"
        title={copy.title}
        action={onMeasureAgain && <Button type="button" variant="weak" size="small" className="max-sm:min-h-44" onClick={() => onMeasureAgain(figures.wholeBin ? undefined : figures.layers[0]?.layerId)}>{MEASURE_AGAIN_LABEL}</Button>}
      >
        {copy.body}
        <ExplanationInfo title={copy.whyTitle} hint={copy.why} panelClassName={FLOW_PANEL_CLASS}>
          <MassFlowSankey diagram={reestimateFlow(figures, preview.binName, kind)} />
        </ExplanationInfo>
        {copy.pairs.length > 0 && (
          <div className="mt-8 flex flex-col gap-8">
            {copy.pairs.map((pair) => <LedgerBeforeAfter key={pair.key} labels={[pair.beforeLabel, AFTER_SAVING_LABEL]} before={pair.before} after={pair.after} stackOnPhone />)}
          </div>
        )}
      </Notice>
    </div>
  );
}
