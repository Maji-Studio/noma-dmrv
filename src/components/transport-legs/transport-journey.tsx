"use client";

/**
 * The route rail: stops as dots, each leg on the rail between them with its
 * method glyph in the line, the counted distance in a right-hand column.
 *
 * One leg (almost every record) shows its counted distance once, beside the
 * leg, and names its load on the leg's detail line. Several legs keep their
 * own figures and add a total under the last stop, the only place a sum is
 * new information.
 */
import type { ReactNode } from "react";
import {
  AirplaneIcon,
  BoatIcon,
  FileDashedIcon,
  FileTextIcon,
  PathIcon,
  PipeIcon,
  TrainIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDistanceKm, formatMass } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { TransportMethodValue } from "@/schemas/transport-legs";
import {
  transportMethodLabel,
  type Journey,
  type JourneyLeg,
} from "./transport-journey-model";

// One glyph per stored transport method. The stored enum is wider than the
// selectable one (only road is offered until the Isometric blueprint binds the
// other emission factors), so every value keeps an icon and an unknown value
// still draws a route glyph rather than nothing.
const TRANSPORT_METHOD_ICONS: Record<TransportMethodValue, Icon> = {
  road: TruckIcon,
  rail: TrainIcon,
  ship: BoatIcon,
  pipeline: PipeIcon,
  aircraft: AirplaneIcon,
};
const FALLBACK_METHOD_ICON: Icon = PathIcon;

const METHOD_ICON_PX = 14;
const EVIDENCE_ICON_PX = 16;
const GRID = "grid grid-cols-[16px_1fr_auto] gap-x-12";

function stopName(name: string | null): string {
  return name ?? MISSING_VALUE.notRecorded;
}

function Stop({ name }: { name: string | null }) {
  return (
    <div className={GRID}>
      <span className="flex justify-center pt-8" aria-hidden>
        <span className="size-8 rounded-full bg-[var(--color-text-primary)]" />
      </span>
      <p className="col-span-2 body-medium text-[var(--color-text-primary)]">
        {stopName(name)}
      </p>
    </div>
  );
}

function EvidenceIcon({ attached }: { attached: boolean }) {
  const label = attached ? "Evidence attached" : "No evidence";
  const Glyph = attached ? FileTextIcon : FileDashedIcon;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0",
        attached ? "text-[var(--st-ok)]" : "text-[var(--color-text-tertiary)]",
      )}
    >
      <Glyph size={EVIDENCE_ICON_PX} weight={attached ? "fill" : "regular"} aria-hidden />
    </span>
  );
}

function LegRow({
  leg,
  showLoad,
  evidenceAttached,
  actions,
}: {
  leg: JourneyLeg;
  showLoad: boolean;
  evidenceAttached: boolean | undefined;
  actions: ReactNode;
}) {
  const MethodIcon =
    TRANSPORT_METHOD_ICONS[leg.method as TransportMethodValue] ?? FALLBACK_METHOD_ICON;
  const method = transportMethodLabel(leg.method);
  // Label and value pairs, so a missing value is the shared token itself.
  const source = `Distance source: ${leg.sourceLabel ?? MISSING_VALUE.notRecorded}`;
  const load = showLoad ? ` · Load: ${formatMass(leg.loadKg)}` : "";

  return (
    <div className={GRID}>
      <span className="flex flex-col items-center py-4" aria-hidden>
        <span className="w-1 flex-1 bg-[var(--color-border-secondary)]" />
        <span className="py-4 text-[var(--color-icon-secondary)]">
          <MethodIcon size={METHOD_ICON_PX} />
        </span>
        <span className="w-1 flex-1 bg-[var(--color-border-secondary)]" />
      </span>
      <div className="min-w-0 space-y-2 py-12">
        <p className="body-medium text-[var(--color-text-secondary)]">
          <span className="sr-only">{`Leg to ${stopName(leg.destinationName)}. `}</span>
          {leg.oneWayKm == null ? (
            `${method} · One way: ${formatDistanceKm(leg.oneWayKm)}`
          ) : (
            <>
              {method} · <span className="tabular-nums">{formatDistanceKm(leg.oneWayKm)}</span> one way
            </>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-8 body-caption text-[var(--color-text-tertiary)]">
          <span className="tabular-nums">{`${source}${load}`}</span>
          {evidenceAttached !== undefined && <EvidenceIcon attached={evidenceAttached} />}
        </p>
      </div>
      <div className="flex items-start gap-4 py-12">
        <div className="text-right">
          {leg.countedKm == null ? (
            <p className="body-medium text-[var(--color-text-tertiary)]">{MISSING_VALUE.notRecorded}</p>
          ) : (
            <>
              <p className="body-medium tabular-nums text-[var(--color-text-primary)]">
                {formatDistanceKm(leg.countedKm)}
              </p>
              <p className="body-caption text-[var(--color-text-tertiary)]">round trip</p>
            </>
          )}
        </div>
        {actions}
      </div>
    </div>
  );
}

export function TransportJourney({
  journey,
  label,
  evidence,
  actions,
}: {
  journey: Journey;
  /** Accessible name of the list, e.g. "Feedstock to processing journey". */
  label: string;
  /** Evidence state per leg index; undefined hides the icon. */
  evidence?: (index: number) => boolean | undefined;
  /** Edit and delete controls per leg index, in edit mode. */
  actions?: (index: number) => ReactNode;
}) {
  const multi = journey.legs.length > 1;
  return (
    <div>
      <ol aria-label={label}>
        {journey.legs.map((leg) => (
          <li key={leg.index}>
            {leg.startsNewStop && <Stop name={leg.originName} />}
            <LegRow
              leg={leg}
              showLoad={journey.loadOnLegs}
              evidenceAttached={evidence?.(leg.index)}
              actions={actions?.(leg.index)}
            />
            <Stop name={leg.destinationName} />
          </li>
        ))}
      </ol>
      {multi && (
        <div className={cn(GRID, "mt-16")}>
          <span />
          <dl className="col-span-2 grid grid-cols-[1fr_auto] gap-x-12 gap-y-4 body-small">
            <dt className="text-[var(--color-text-tertiary)]">Distance counted, all legs</dt>
            <dd className="text-right body-medium tabular-nums text-[var(--color-text-primary)]">
              {formatDistanceKm(journey.totalCountedKm)}
            </dd>
            {journey.sharedLoadKg != null && (
              <>
                <dt className="text-[var(--color-text-tertiary)]">Load carried</dt>
                <dd className="text-right body-medium tabular-nums text-[var(--color-text-primary)]">
                  {formatMass(journey.sharedLoadKg)}
                </dd>
              </>
            )}
          </dl>
          {journey.missingDistances > 0 && (
            <>
              <span />
              <p className="col-span-2 mt-4 body-caption text-[var(--color-text-tertiary)]">
                {journey.missingDistances}{" "}
                {journey.missingDistances === 1 ? "leg has" : "legs have"} no recorded distance.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
