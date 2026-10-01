/**
 * EnergyActivityPanel: the selection's recorded activity per source, in the
 * units operators enter, with the estimate beside it when factors are set.
 */
import { formatCount } from "@/lib/copy-utils";
import type { SourceTotal } from "@/lib/energy/selection";
import {
  ENERGY_SOURCE_BY_KEY,
  type EnergySourceKey,
} from "@/lib/energy/sources";
import { ENERGY_SOURCE_FILL, formatActivity, formatEstimate } from "./energy-display";

const GROUPS: { title: string; keys: EnergySourceKey[] }[] = [
  { title: "Electricity", keys: ["grid"] },
  { title: "Diesel", keys: ["startup", "genset", "preprocessing"] },
  { title: "Transport", keys: ["feedstockTransport", "biocharTransport"] },
];

interface EnergyActivityPanelProps {
  title: string;
  caption: string;
  totals: Record<EnergySourceKey, SourceTotal>;
  hasFactors: boolean;
}

export function EnergyActivityPanel({
  title,
  caption,
  totals,
  hasFactors,
}: EnergyActivityPanelProps) {
  const values = Object.values(totals);
  const totalKg = values.reduce((sum, total) => sum + (total.kg ?? 0), 0);
  const missing = values.reduce((sum, total) => sum + total.missingReadings, 0);

  return (
    <aside
      aria-label="Activity totals"
      className="flex flex-col gap-16 bg-[var(--panel-bg)] p-20 [border:var(--panel-border)]"
    >
      <div className="flex flex-col gap-4">
        <h2 className="title-heading-3">{title}</h2>
        <p className="body-caption text-[var(--color-text-secondary)]">{caption}</p>
      </div>
      <p className="body-caption text-[var(--color-text-secondary)]">
        {hasFactors
          ? "Recorded activity in the units operators enter. CO₂e figures are estimates from this facility's emission factors."
          : "Recorded activity in the units operators enter."}
      </p>
      {GROUPS.map((group) => (
        <section key={group.title} className="flex flex-col gap-8">
          <h3 className="body-small font-medium">{group.title}</h3>
          <dl className="flex flex-col">
            {group.keys.map((key) => {
              const total = totals[key];
              const meta = ENERGY_SOURCE_BY_KEY[key];
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-12 py-8 [border-top:var(--row-divider)]"
                >
                  <dt className="flex items-center gap-8 body-small">
                    <span
                      aria-hidden="true"
                      className="inline-block size-8 shrink-0 rounded-full"
                      style={{ background: ENERGY_SOURCE_FILL[key] }}
                    />
                    {meta.label}
                  </dt>
                  <dd className="flex flex-col items-end">
                    <span className="body-small font-medium tabular-nums">
                      {formatActivity(total.activity, meta.unit)}
                    </span>
                    {total.kg != null && (
                      <span className="body-caption text-[var(--color-text-secondary)] tabular-nums">
                        {formatEstimate(total.kg)}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
      {hasFactors && (
        <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-primary)] pt-12">
          <span className="body-small font-medium">Total</span>
          <span className="body-small font-medium tabular-nums">{formatEstimate(totalKg)}</span>
        </div>
      )}
      {missing > 0 && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          {formatCount(missing, "reading")} not recorded in this selection, so the
          totals are a floor.
        </p>
      )}
    </aside>
  );
}
