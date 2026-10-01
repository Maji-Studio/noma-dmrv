/**
 * PROTOTYPE C · Ledger rows. No drawing at all: the leg reads as label and
 * value rows, the same shape as every other field in the sheet, so transport
 * looks like the rest of the step instead of a widget. Not for merge.
 */
"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { PrototypeJourney, PrototypeLeg } from "./journey";
import { km, tonnes } from "./journey";
import { EvidenceMark } from "./evidence-mark";

const ICON_PX = 14;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="body-small text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="min-w-0 body-small text-[var(--color-text-primary)]">{children}</dd>
    </>
  );
}

function LegRows({ leg, journey }: { leg: PrototypeLeg; journey: PrototypeJourney }) {
  return (
    <dl className="grid grid-cols-[112px_1fr] gap-x-16 gap-y-8">
      <Row label="Route">
        <span className="inline-flex flex-wrap items-center gap-x-6">
          {leg.from}
          <ArrowRightIcon size={ICON_PX} className="text-[var(--color-icon-secondary)]" aria-label="to" />
          {leg.to}
        </span>
      </Row>
      <Row label="One way">
        <span className="tabular-nums">{km(leg.oneWayKm)}</span>
        <span className="text-[var(--color-text-tertiary)]">
          {` by ${leg.methodLabel.toLowerCase()}`}
          {leg.sourceLabel && ` · ${leg.sourceLabel}`}
        </span>
      </Row>
      <Row label="Counted">
        <span className="font-medium tabular-nums">{km(leg.countedKm)}</span>
        <span className="text-[var(--color-text-tertiary)]"> round trip</span>
      </Row>
      {!journey.hideLoad && (journey.loadsVary || journey.legs.length === 1) && (
        <Row label="Load">
          <span className="tabular-nums">{tonnes(leg.loadKg)}</span>
        </Row>
      )}
      {leg.evidenceAttached !== undefined && (
        <Row label="Evidence">
          <EvidenceMark attached={leg.evidenceAttached} withLabel />
        </Row>
      )}
    </dl>
  );
}

export function VariantLedger({ journey }: { journey: PrototypeJourney }) {
  if (journey.legs.length === 1) {
    const [leg] = journey.legs;
    return (
      <div className="flex items-start gap-8">
        <div className="min-w-0 flex-1">
          <LegRows leg={leg} journey={journey} />
        </div>
        {leg.actions}
      </div>
    );
  }
  return (
    <div className="space-y-20">
      {journey.legs.map((leg) => (
        <section key={leg.index} className="space-y-8">
          <div className="flex items-center justify-between gap-8">
            <p className="body-small font-medium text-[var(--color-text-primary)]">Leg {leg.index + 1}</p>
            {leg.actions}
          </div>
          <LegRows leg={leg} journey={journey} />
        </section>
      ))}
      <dl className="grid grid-cols-[112px_1fr] gap-x-16 gap-y-8">
        <Row label="Counted total">
          <span className="font-medium tabular-nums">{km(journey.totalCountedKm)}</span>
        </Row>
        {!journey.hideLoad && !journey.loadsVary && (
          <Row label="Load">
            <span className="tabular-nums">{tonnes(journey.sharedLoadKg)}</span>
          </Row>
        )}
      </dl>
    </div>
  );
}
