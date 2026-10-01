/**
 * PROTOTYPE A · Route strip. Each leg is a horizontal line between its two
 * stops with the one-way distance riding on the line, then one row of three
 * figures for the whole journey: counted distance, load, evidence. Not for merge.
 */
"use client";

import type { PrototypeJourney } from "./journey";
import { km, tonnes } from "./journey";
import { EvidenceMark } from "./evidence-mark";

const ICON_PX = 16;

function Figure({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="body-medium font-medium tabular-nums text-[var(--color-text-primary)]">{value}</p>
      <p className="body-caption text-[var(--color-text-tertiary)]">{label}</p>
    </div>
  );
}

export function VariantRouteStrip({ journey }: { journey: PrototypeJourney }) {
  const evidenceKnown = journey.legs.some((leg) => leg.evidenceAttached !== undefined);
  const allEvidence = journey.legs.every((leg) => leg.evidenceAttached);
  const multi = journey.legs.length > 1;

  return (
    <div className="space-y-16">
      <ol className="space-y-16">
        {journey.legs.map((leg) => (
          <li key={leg.index} className="space-y-6">
            <div className="flex items-start justify-between gap-16 body-small font-medium text-[var(--color-text-primary)]">
              <span className="min-w-0">{leg.from}</span>
              <span className="min-w-0 text-right">{leg.to}</span>
              {leg.actions}
            </div>
            <div className="relative flex h-24 items-center" aria-hidden>
              <span className="size-8 shrink-0 rounded-full bg-[var(--color-text-primary)]" />
              <span className="h-2 flex-1 bg-[var(--color-border-secondary)]" />
              <span className="size-8 shrink-0 rounded-full bg-[var(--color-text-primary)]" />
              <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-6 bg-[var(--color-background-white)] px-8 body-small tabular-nums text-[var(--color-text-primary)]">
                <leg.MethodIcon size={ICON_PX} className="text-[var(--color-icon-secondary)]" />
                {km(leg.oneWayKm)}
              </span>
            </div>
            <p className="text-center body-caption text-[var(--color-text-tertiary)]">
              One way by {leg.methodLabel.toLowerCase()}
              {leg.sourceLabel && ` · ${leg.sourceLabel}`}
              {multi && journey.loadsVary && ` · ${tonnes(leg.loadKg)}`}
            </p>
            <p className="sr-only">
              {`Leg from ${leg.from} to ${leg.to}, ${km(leg.oneWayKm)} one way by ${leg.methodLabel}.`}
            </p>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-3 gap-12 bg-[var(--color-background-light)] px-12 py-12">
        <Figure
          value={km(journey.totalCountedKm)}
          label={multi ? "Counted, all legs" : "Counted, round trip"}
        />
        {journey.hideLoad ? (
          <Figure value="×2" label="Vehicle returns empty" />
        ) : (
          <Figure
            value={journey.loadsVary ? "Varies" : tonnes(journey.sharedLoadKg)}
            label="Load carried"
          />
        )}
        {evidenceKnown ? (
          <div className="min-w-0 space-y-2">
            <p className="flex h-24 items-center">
              <EvidenceMark attached={allEvidence} />
            </p>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {allEvidence ? "Evidence attached" : "No evidence"}
            </p>
          </div>
        ) : (
          <span />
        )}
      </div>
      {journey.missingDistances > 0 && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {journey.missingDistances} {journey.missingDistances === 1 ? "leg has" : "legs have"} no recorded distance.
        </p>
      )}
    </div>
  );
}
