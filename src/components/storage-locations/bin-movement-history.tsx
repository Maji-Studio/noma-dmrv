"use client";

import {
  ArrowsClockwiseIcon,
  ScalesIcon,
  TrendDownIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useBinMovements } from "@/hooks/use-bin-movements";
import type { BinMovementWithActor } from "@/data-access/bin-movements";
import { formatMass, formatSafeDate } from "@/lib/format-utils";
import {
  BIN_MOVEMENT_LANE_LABELS,
  type BinMovementLane,
} from "@/schemas/bin-movements";

interface BinMovementHistoryProps {
  storageLocationId: string;
}

function signedMass(deltaKg: number): string {
  if (deltaKg === 0) return formatMass(0);
  const sign = deltaKg > 0 ? "+" : "−";
  return `${sign}${formatMass(Math.abs(deltaKg))}`;
}

function MovementRow({ movement }: { movement: BinMovementWithActor }) {
  const isLoss = movement.movementType === "loss";
  const delta = Number(movement.massDeltaKg);
  const positive = delta > 0;

  return (
    <li className="flex flex-col gap-6 border-b border-[var(--color-border-tertiary)] py-12 last:border-b-0">
      <div className="flex items-center justify-between gap-8">
        <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
          {isLoss ? (
            <TrendDownIcon
              size={15}
              weight="bold"
              className="text-[var(--color-signal-red)]"
            />
          ) : (
            <ScalesIcon
              size={15}
              weight="bold"
              className="text-[var(--color-text-tertiary)]"
            />
          )}
          {isLoss ? "Loss" : "Stock-take"}
          <span className="body-caption text-[var(--color-text-tertiary)]">
            · {BIN_MOVEMENT_LANE_LABELS[movement.lane as BinMovementLane]}
          </span>
        </span>
        <span
          className={`shrink-0 body-small font-mono ${
            positive
              ? "text-[var(--color-signal-green)]"
              : "text-[var(--color-signal-red)]"
          }`}
        >
          {signedMass(delta)}
        </span>
      </div>

      {movement.movementType === "adjustment" &&
        movement.derivedMassKgAtTime != null &&
        movement.countedMassKg != null && (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            Counted {formatMass(Number(movement.countedMassKg))}
            {movement.countedWetMassKg != null && (
              <> (from {formatMass(Number(movement.countedWetMassKg))} wet)</>
            )}{" "}
            vs derived {formatMass(Number(movement.derivedMassKgAtTime))}
          </p>
        )}

      <p className="body-small text-[var(--color-text-secondary)]">
        {movement.reason}
      </p>

      <p className="body-caption text-[var(--color-text-tertiary)]">
        {movement.actorName ? `${movement.actorName} · ` : ""}
        {formatSafeDate(movement.createdAt, "MMM d, yyyy · HH:mm")}
      </p>
    </li>
  );
}

export function BinMovementHistory({
  storageLocationId,
}: BinMovementHistoryProps) {
  const { data: movements, isLoading, error } = useBinMovements(
    storageLocationId
  );

  return (
    <section className="flex flex-col gap-8">
      <h4 className="flex items-center gap-6 title-heading-4 text-[var(--color-text-primary)]">
        <ArrowsClockwiseIcon size={16} weight="bold" />
        Reconciliation history
      </h4>

      {isLoading ? (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Loading history…
        </p>
      ) : error ? (
        <p className="body-caption text-[var(--color-signal-red)]">
          Failed to load reconciliation history.
        </p>
      ) : !movements || movements.length === 0 ? (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          No stock-takes or losses recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {movements.map((movement) => (
            <MovementRow key={movement.id} movement={movement} />
          ))}
        </ul>
      )}
    </section>
  );
}
