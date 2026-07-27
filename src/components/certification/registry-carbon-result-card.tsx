"use client";

import { formatCo2e } from "@/lib/format-utils";
import type { RegistryCarbonResult } from "@/lib/certification/registry-carbon-result";

function RegistryField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] py-8">
      <span className="body-small text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="body-small font-mono text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

export function RegistryCarbonResultCard({
  data,
  scopeLabel,
}: {
  data: RegistryCarbonResult;
  scopeLabel: "Removal" | "GHG Statement";
}) {
  return (
    <section
      className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16"
      aria-label="Isometric registry carbon result"
    >
      <div className="flex flex-col gap-2">
        <span className="label-micro text-[var(--color-text-tertiary)]">
          Isometric registry result
        </span>
        <span className="title-heading-2 tabular-nums text-[var(--color-text-primary)]">
          {formatCo2e(data.netRemovedKg, { signed: true })}
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Net CO₂e removed
        </span>
      </div>

      <div>
        <RegistryField
          label="Net before registry discount"
          value={formatCo2e(data.netBeforeDiscountKg, { signed: true })}
        />
        {data.standardDeviationKg != null && (
          <RegistryField
            label="Registry standard deviation"
            value={`±${formatCo2e(data.standardDeviationKg)}`}
          />
        )}
        {data.riskOfReversalPercent != null && (
          <RegistryField
            label="Registry risk of reversal"
            value={`${data.riskOfReversalPercent}%`}
          />
        )}
        {data.bufferCreditsKg != null && (
          <RegistryField
            label="Registry buffer allocation"
            value={formatCo2e(data.bufferCreditsKg)}
          />
        )}
        {data.supplierCreditsKg != null && (
          <RegistryField
            label="Registry supplier allocation"
            value={formatCo2e(data.supplierCreditsKg)}
          />
        )}
      </div>

      <p className="body-caption text-[var(--color-text-tertiary)]">
        Values shown here come from Isometric. noma does not calculate a
        {` ${scopeLabel}`} carbon result.
      </p>
    </section>
  );
}
