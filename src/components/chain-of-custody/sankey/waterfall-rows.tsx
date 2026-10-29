"use client";

/**
 * Phone: the waterfall as readable HTML
 * rows, the product page's phone layout. Each row is one 44px button with the
 * column's icon, name and value over a track that draws its part of the
 * feedstock in: the first bar full, each step a hatched piece stepping back,
 * the applied bar lit. Steps sit under a header naming the records they leave
 * from. The selected row opens its detail right under it.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  HATCH_BACKGROUND,
  ItemIcon,
  LIT_FILL,
  LIT_INK,
  signedKg,
  STAGE_ICONS,
  START_FILL,
  START_STROKE,
  STEP_STROKE,
  stepFill,
} from "./waterfall-parts";
import { chartMaxKg, type WaterfallItem, type WaterfallItemKey, type WaterfallModel } from "./waterfall-model";

const MIN_BAR_PCT = 0.6;

interface WaterfallRowsProps {
  model: WaterfallModel;
  activeKey: WaterfallItemKey | null;
  onSelect: (key: WaterfallItemKey) => void;
  /** Rendered under the active row. */
  renderDetail?: (item: WaterfallItem) => ReactNode;
}

function barStyle(item: WaterfallItem, maxKg: number) {
  const pct = (kg: number) => (maxKg > 0 ? (kg / maxKg) * 100 : 0);
  const left = pct(item.bottom);
  const length = Math.max(MIN_BAR_PCT, pct(item.top - item.bottom));
  const common = { left: `${left}%`, width: `${length}%` };
  if (item.kind === "step") {
    return {
      ...common,
      ...(item.key === "water_driven_off" ? HATCH_BACKGROUND : { background: stepFill(item) }),
      border: `1px solid ${STEP_STROKE}`,
    };
  }
  if (item.kind === "end") return { ...common, background: LIT_FILL };
  return { ...common, background: START_FILL, border: `1px solid ${START_STROKE}` };
}

export function WaterfallRows({ model, activeKey, onSelect, renderDetail }: WaterfallRowsProps) {
  const maxKg = chartMaxKg(model);
  const rows: ReactNode[] = [];
  let lastStage: string | null = null;
  for (const item of model.items) {
    if (item.stage && item.stage !== lastStage) {
      const group = model.groups.find((entry) => entry.stage === item.stage);
      const StageIcon = STAGE_ICONS[item.stage];
      rows.push(
        <li key={`group-${item.stage}`} className="flex items-center gap-6 pb-2 pt-16 text-[var(--color-text-tertiary)]">
          <StageIcon size={14} aria-hidden />
          <span className="body-caption">{group?.label}</span>
        </li>,
      );
    }
    lastStage = item.stage;
    const active = activeKey === item.key;
    const lit = item.kind === "end";
    rows.push(
      <li key={item.key} className={active ? "bg-[var(--sea)]" : undefined}>
        <button
          type="button"
          className={cn(
            "grid min-h-44 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-6 px-8 py-10 text-left",
            !active && "hover:bg-[var(--clr-dark-purple-1)]",
          )}
          aria-pressed={active}
          aria-label={`${item.label}: ${signedKg(item)} kg`}
          data-testid={`sankey-row-${item.key}`}
          onClick={() => onSelect(item.key)}
        >
          <span className="body-small flex min-w-0 items-center gap-8" style={{ color: lit ? LIT_INK : "var(--color-text-primary)" }}>
            <ItemIcon item={item} size={18} className="shrink-0" />
            <span className="truncate">{item.label}</span>
          </span>
          <span
            className="body-small whitespace-nowrap tabular-nums"
            style={{ color: lit ? LIT_INK : item.kind === "step" ? "var(--color-text-secondary)" : "var(--color-text-primary)" }}
          >
            {signedKg(item)} kg
          </span>
          <span className="relative col-span-2 h-8" aria-hidden>
            <span className="absolute inset-y-0 box-border" style={barStyle(item, maxKg)} />
          </span>
        </button>
        {active && renderDetail ? <div className="px-8 pb-12 pt-4">{renderDetail(item)}</div> : null}
      </li>,
    );
  }
  return (
    <ol className="flex flex-col" aria-label="Mass balance in kg" data-testid="sankey-rows">
      {rows}
    </ol>
  );
}
