/**
 * PROTOTYPE B · Itinerary. A vertical rail like a timetable: stops are dots,
 * each leg sits ON the rail (method icon in the line, no box), and the counted
 * distance is a right-hand column that sums at the bottom. Not for merge.
 */
"use client";

import type { PrototypeJourney } from "./journey";
import { km, tonnes } from "./journey";
import { EvidenceMark } from "./evidence-mark";

const ICON_PX = 14;

function Stop({ name }: { name: string }) {
  return (
    <>
      <span className="flex justify-center pt-6" aria-hidden>
        <span className="size-8 rounded-full bg-[var(--color-text-primary)]" />
      </span>
      <p className="col-span-2 body-small font-medium text-[var(--color-text-primary)]">{name}</p>
    </>
  );
}

export function VariantItinerary({ journey }: { journey: PrototypeJourney }) {
  const multi = journey.legs.length > 1;
  // One leg: its own figure is the total, so the load rides on the leg and no
  // footer repeats the distance. Several legs: the footer sums them.
  const loadOnLeg = !journey.hideLoad && (!multi || journey.loadsVary);
  return (
    <div className="grid grid-cols-[16px_1fr_auto] gap-x-12">
      {journey.legs.map((leg, position) => (
        <div key={leg.index} className="contents">
          {(position === 0 || journey.legs[position - 1].to !== leg.from) && <Stop name={leg.from} />}
          {/* The leg: the rail with the method glyph in it, then its figures. */}
          <span className="flex flex-col items-center py-4" aria-hidden>
            <span className="w-1 flex-1 bg-[var(--color-border-secondary)]" />
            <span className="py-4 text-[var(--color-icon-secondary)]">
              <leg.MethodIcon size={ICON_PX} />
            </span>
            <span className="w-1 flex-1 bg-[var(--color-border-secondary)]" />
          </span>
          <div className="min-w-0 space-y-2 py-12">
            <p className="body-small text-[var(--color-text-secondary)]">
              {leg.methodLabel} · <span className="tabular-nums">{km(leg.oneWayKm)}</span> one way
            </p>
            <p className="flex flex-wrap items-center gap-8 body-caption text-[var(--color-text-tertiary)]">
              <span className="tabular-nums">
                {leg.sourceLabel ?? "Distance source not recorded"}
                {loadOnLeg && ` · ${tonnes(leg.loadKg)} load`}
              </span>
              <EvidenceMark attached={leg.evidenceAttached} />
            </p>
          </div>
          <div className="flex items-start gap-4 py-12">
            <div className="text-right">
              <p className="body-small font-medium tabular-nums text-[var(--color-text-primary)]">
                {km(leg.countedKm)}
              </p>
              <p className="body-caption text-[var(--color-text-tertiary)]">round trip</p>
            </div>
            {leg.actions}
          </div>
          <Stop name={leg.to} />
        </div>
      ))}

      {multi && (
        <>
          <span />
          <dl className="col-span-2 mt-16 grid grid-cols-[1fr_auto] gap-x-12 gap-y-4 body-small">
            <dt className="text-[var(--color-text-tertiary)]">Distance counted, all legs</dt>
            <dd className="text-right font-medium tabular-nums text-[var(--color-text-primary)]">
              {km(journey.totalCountedKm)}
            </dd>
            {!journey.hideLoad && !journey.loadsVary && (
              <>
                <dt className="text-[var(--color-text-tertiary)]">Load carried</dt>
                <dd className="text-right tabular-nums text-[var(--color-text-secondary)]">
                  {tonnes(journey.sharedLoadKg)}
                </dd>
              </>
            )}
          </dl>
        </>
      )}
    </div>
  );
}
