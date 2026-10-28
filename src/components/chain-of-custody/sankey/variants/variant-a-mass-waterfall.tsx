"use client";

/**
 * PROTOTYPE variant A, "Mass waterfall" (?variant=a). The ribbon is replaced
 * by the product page's waterfall in kg: the big applied figure at the left
 * with one sentence of how it is made, the waterfall beside it, and one
 * caption row under it that turns into the column's detail (records count and
 * "See details") on hover or tap.
 */
import { useSearchParams } from "next/navigation";
import type { CreditBatchSankeyData } from "@/lib/chain-of-custody/sankey";
import { WaterfallChart } from "./waterfall-chart";
import { buildWaterfall, type WaterfallLineage } from "./waterfall-model";
import { WaterfallRows } from "./waterfall-rows";
import {
  DefaultCaption,
  HeadlineFigure,
  ItemDetail,
  MassWarnings,
  ROWS_BELOW_PX,
  useColumnFocus,
  useMeasuredWidth,
} from "./waterfall-shared";

const PLOT_HEIGHT_PX = 320;

export interface SankeyVariantProps {
  sankey: CreditBatchSankeyData;
  lineages: readonly WaterfallLineage[];
  batchCode: string;
}

export function VariantAMassWaterfall({ sankey, lineages, batchCode }: SankeyVariantProps) {
  const facilityId = useSearchParams().get("facility");
  const model = buildWaterfall(sankey, lineages);
  const focus = useColumnFocus();
  const [width, measure] = useMeasuredWidth();
  const [chartWidth, measureChart] = useMeasuredWidth();
  const rows = width < ROWS_BELOW_PX;
  const activeItem = model.items.find((item) => item.key === focus.active) ?? null;

  return (
    <div className="h-full overflow-auto bg-[var(--color-background-white)]" data-testid="batch-sankey" aria-label={`Mass balance for credit batch ${batchCode}`}>
      <div ref={measure} className="container-max flex flex-col gap-24 pb-96 pt-32">
        {rows ? (
          <>
            <HeadlineFigure model={model} compact />
            <WaterfallRows
              model={model}
              activeKey={focus.pinned}
              onSelect={focus.toggle}
              renderDetail={(item) => <ItemDetail item={item} facilityId={facilityId} layout="stack" />}
            />
            <div className="border-t border-[var(--clr-dark-purple-10)] pt-12">
              <DefaultCaption rows />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,9fr)] items-end gap-48">
              <div className="pb-96">
                <HeadlineFigure model={model} />
              </div>
              <div ref={measureChart} className="min-w-0">
                <WaterfallChart
                  model={model}
                  width={chartWidth}
                  plotHeight={PLOT_HEIGHT_PX}
                  activeKey={focus.active}
                  pinnedKey={focus.pinned}
                  onHover={focus.hover}
                  onSelect={focus.toggle}
                />
              </div>
            </div>
            <div className="flex min-h-64 items-center border-t border-[var(--clr-dark-purple-10)] pt-12" aria-live="polite">
              {activeItem ? <ItemDetail item={activeItem} facilityId={facilityId} /> : <DefaultCaption />}
            </div>
          </>
        )}
        <MassWarnings warnings={model.warnings} />
      </div>
    </div>
  );
}
