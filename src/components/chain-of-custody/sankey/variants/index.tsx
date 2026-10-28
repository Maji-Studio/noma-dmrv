"use client";

/**
 * PROTOTYPE: Sankey waterfall variants behind ?variant=a|b|c on the batch
 * Sankey. No param keeps the current view as the baseline. Once one is
 * picked, fold it in and delete this folder and its imports in
 * traceability-page.tsx.
 */
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { NO_APPLICATION_SANKEY_MESSAGE } from "@/lib/chain-of-custody/copy";
import { VariantAMassWaterfall, type SankeyVariantProps } from "./variant-a-mass-waterfall";
import { VariantBWaterfallRecords } from "./variant-b-waterfall-records";
import { VariantCSankeyRestyled } from "./variant-c-sankey-restyled";
import type { SankeyVariant } from "./variant-switcher";

export { parseSankeyVariant, SankeyVariantSwitcher } from "./variant-switcher";

export function SankeyVariantView({ variant, ...props }: SankeyVariantProps & { variant: SankeyVariant }) {
  if (variant === "b") return <VariantBWaterfallRecords {...props} />;
  if (variant === "c") return <VariantCSankeyRestyled {...props} />;
  return <VariantAMassWaterfall {...props} />;
}

/** Nothing applied yet: the EmptyState, never bare text. */
export function SankeyVariantEmpty({ onOpenFlow }: { onOpenFlow: () => void }) {
  return (
    <div className="container-max flex h-full items-center justify-center py-24">
      <div className="w-full max-w-[640px]">
        <EmptyState
          icon={<ChartBarIcon size={48} weight="thin" />}
          title="Nothing applied yet"
          description={NO_APPLICATION_SANKEY_MESSAGE}
          action={
            <Button variant="weak" onClick={onOpenFlow}>
              Open Flow
            </Button>
          }
        />
      </div>
    </div>
  );
}
