/**
 * The pieces of one energy record row: the per-source bar, and the expanded
 * breakdown with what was recorded, its estimate and any missing readings.
 */
import { formatCount } from "@/lib/copy-utils";
import { recordDieselLitres, recordKg } from "@/lib/energy/selection";
import {
  DIESEL_SOURCE_KEYS,
  ENERGY_SOURCES,
  PRODUCTION_FOOTPRINT_KEYS,
  type EnergySourceKey,
} from "@/lib/energy/sources";
import type { EnergyRecord, ReadingGap } from "@/lib/energy/types";
import { formatMass } from "@/lib/format-utils";
import { ENERGY_SOURCE_FILL, formatActivity, formatEstimate } from "./energy-display";

const PERCENT = 100;
const BAR_MIN_WIDTH_CLASS = "min-w-[96px]";

const GAP_UNITS: Record<ReadingGap["unit"], [string, string]> = {
  run: ["run", "runs"],
  feedstock: ["feedstock", "feedstocks"],
  delivery: ["delivery", "deliveries"],
};

function sourcesFor(record: EnergyRecord): EnergySourceKey[] {
  const keys = record.scope === "run" ? PRODUCTION_FOOTPRINT_KEYS : ENERGY_SOURCES.map((s) => s.key);
  return [...keys];
}

/** One bar per record, split by source: CO2e, or diesel litres without factors. */
export function EnergySourceBar({ record }: { record: EnergyRecord }) {
  const kg = record.footprint.kg;
  const amounts = kg ?? record.footprint.activity;
  const keys: readonly EnergySourceKey[] = kg ? sourcesFor(record) : DIESEL_SOURCE_KEYS;
  const total = kg ? (recordKg(record) ?? 0) : recordDieselLitres(record);
  const parts = keys.filter((key) => amounts[key] > 0);
  const label = ENERGY_SOURCES.filter((s) => parts.includes(s.key))
    .map((s) => `${s.label} ${Math.round((amounts[s.key] / total) * PERCENT)}%`)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={label || "Nothing recorded"}
      className={`flex h-8 w-full ${BAR_MIN_WIDTH_CLASS} overflow-hidden bg-[var(--color-background-medium)]`}
    >
      {parts.map((key) => (
        <span
          key={key}
          style={{ width: `${(amounts[key] / total) * PERCENT}%`, background: ENERGY_SOURCE_FILL[key] }}
        />
      ))}
    </div>
  );
}

function gapText(gap: ReadingGap, leading: boolean): string {
  const [singular, plural] = GAP_UNITS[gap.unit];
  const text = `${gap.missing} of ${formatCount(gap.of, singular, plural)}`;
  return leading ? `Not recorded on ${text}` : `not recorded on ${text}`;
}

function recordNote(record: EnergyRecord): string | null {
  switch (record.scope) {
    case "batch":
      return `${formatCount(record.runCount, "production run")} and ${formatCount(record.deliveryCount, "delivery", "deliveries")} behind these figures. Delivery transport counts the share of each truck that carried this credit batch.`;
    case "run":
      return "Feedstock transport is this run's share of each feedstock, by wet mass drawn.";
    case "delivery":
      return record.dryMassKg == null
        ? null
        : `Includes the production energy of the ${formatMass(record.dryMassKg)} of dry biochar on this truck, by dry mass from ${formatCount(record.runCount, "production run")}.`;
    case "application":
      return "Includes this application's share of production energy and of its delivery's transport, by dry mass. Spreading is not recorded.";
  }
}

export function EnergyRecordBreakdown({ record }: { record: EnergyRecord }) {
  const note = recordNote(record);
  const { activity, kg, gaps } = record.footprint;
  return (
    <div className="flex flex-col gap-12 px-16 pb-16 pt-4">
      <dl className="grid grid-cols-1 gap-x-32 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {ENERGY_SOURCES.filter((source) => sourcesFor(record).includes(source.key)).map((source) => {
          const gap = gaps[source.key];
          return (
            <div key={source.key} className="flex items-start justify-between gap-12">
              <dt className="flex items-center gap-8 body-small">
                <span
                  aria-hidden="true"
                  className="inline-block size-8 shrink-0 rounded-full"
                  style={{ background: ENERGY_SOURCE_FILL[source.key] }}
                />
                {source.label}
              </dt>
              <dd className="flex flex-col items-end text-right">
                <span className="body-small tabular-nums">
                  {kg ? formatEstimate(kg[source.key]) : formatActivity(activity[source.key], source.unit)}
                </span>
                <span className="body-caption text-[var(--color-text-secondary)]">
                  {kg ? formatActivity(activity[source.key], source.unit) : null}
                  {kg && gap ? ", " : null}
                  {gap ? gapText(gap, !kg) : null}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      {note && <p className="body-caption text-[var(--color-text-secondary)]">{note}</p>}
    </div>
  );
}
