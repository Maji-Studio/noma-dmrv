/**
 * PROTOTYPE D · Mass × distance. Leads with the figure the emissions use: the
 * load times the counted round trip, written out as the sum it is, so the
 * doubling is visible arithmetic rather than a second distance in prose. The
 * route shrinks to one line above it. Not for merge.
 */
"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { PrototypeJourney, PrototypeLeg } from "./journey";
import { km, tonneKm, tonnes } from "./journey";
import { EvidenceMark } from "./evidence-mark";

const ICON_PX = 14;

function Term({ value, label, strong = false }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className="min-w-0 space-y-2">
      <p
        className={
          strong
            ? "body-medium font-medium tabular-nums text-[var(--color-text-primary)]"
            : "body-medium tabular-nums text-[var(--color-text-secondary)]"
        }
      >
        {value}
      </p>
      <p className="body-caption text-[var(--color-text-tertiary)]">{label}</p>
    </div>
  );
}

function Operator({ children }: { children: string }) {
  return (
    <span className="body-medium text-[var(--color-text-tertiary)]" aria-hidden>
      {children}
    </span>
  );
}

function LegSum({ leg, hideLoad }: { leg: PrototypeLeg; hideLoad: boolean }) {
  const doubling = `${km(leg.oneWayKm)} one way × 2`;
  if (hideLoad) {
    return (
      <div className="grid grid-cols-[auto_auto_auto_auto_auto] items-start justify-start gap-x-12">
        <Term value={km(leg.oneWayKm)} label={`one way${leg.sourceLabel ? `, ${leg.sourceLabel.toLowerCase()}` : ""}`} />
        <Operator>×</Operator>
        <Term value="2" label="round trip" />
        <Operator>=</Operator>
        <Term value={km(leg.countedKm)} label="counted" strong />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[auto_auto_auto_auto_auto] items-start justify-start gap-x-12">
      <Term value={tonnes(leg.loadKg)} label="load" />
      <Operator>×</Operator>
      <Term value={km(leg.countedKm)} label={doubling} />
      <Operator>=</Operator>
      <Term value={tonneKm(leg.tonneKm)} label="counted" strong />
    </div>
  );
}

export function VariantMassDistance({ journey }: { journey: PrototypeJourney }) {
  const multi = journey.legs.length > 1;
  return (
    <div className="space-y-16">
      {journey.legs.map((leg) => (
        <div key={leg.index} className="space-y-12">
          <div className="flex items-start gap-8">
            <leg.MethodIcon size={ICON_PX} className="mt-4 shrink-0 text-[var(--color-icon-secondary)]" aria-hidden />
            <p className="min-w-0 flex-1 body-small font-medium text-[var(--color-text-primary)]">
              {leg.from}
              <ArrowRightIcon size={ICON_PX} className="mx-6 inline align-[-2px] text-[var(--color-icon-secondary)]" aria-label="to" />
              {leg.to}
            </p>
            <EvidenceMark attached={leg.evidenceAttached} />
            {leg.actions}
          </div>
          <div className="pl-24">
            <LegSum leg={leg} hideLoad={journey.hideLoad} />
          </div>
        </div>
      ))}
      {multi && (
        <div className="flex items-baseline justify-between gap-8 bg-[var(--color-background-light)] px-12 py-8">
          <span className="body-small text-[var(--color-text-tertiary)]">
            {journey.hideLoad ? "Counted, all legs" : "Mass × distance, all legs"}
          </span>
          <span className="body-medium font-medium tabular-nums text-[var(--color-text-primary)]">
            {journey.hideLoad ? km(journey.totalCountedKm) : tonneKm(journey.totalTonneKm)}
          </span>
        </div>
      )}
    </div>
  );
}
