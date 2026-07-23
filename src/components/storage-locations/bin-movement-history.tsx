"use client";

import {
  ArrowsClockwiseIcon,
  ScalesIcon,
  TrendDownIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useBinMovements } from "@/hooks/use-bin-movements";
import type { BinMovementWithActor } from "@/data-access/bin-movements";
import { formatDateTime, formatMass } from "@/lib/format-utils";
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

function formatRecordedMoisture(ratio: number): string {
  const percent = ratio * 100;
  return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
}

function MovementRow({ movement }: { movement: BinMovementWithActor }) {
  const isLoss = movement.movementType === "loss";
  const delta = Number(movement.massDeltaKg);
  const deltaColorClass =
    delta > 0
      ? "text-[var(--st-ok)]"
      : delta < 0
        ? "text-[var(--color-signal-red)]"
        : "text-[var(--color-text-primary)]";

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
          className={`shrink-0 body-small font-mono ${deltaColorClass}`}
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
              <>
                {" "}
                (from {formatMass(Number(movement.countedWetMassKg))} wet)
              </>
            )}
            {movement.moistureRatioUsed != null && (
              <>
                {" "}
                at{" "}
                {formatRecordedMoisture(
                  Number(movement.moistureRatioUsed),
                )}{" "}
                moisture
              </>
            )}{" "}
            vs derived {formatMass(Number(movement.derivedMassKgAtTime))}
          </p>
        )}

      <p className="body-small text-[var(--color-text-secondary)]">
        {movement.reason}
      </p>

      <p className="body-caption text-[var(--color-text-tertiary)]">
        {movement.actorName ? `${movement.actorName} · ` : ""}
        {formatDateTime(movement.createdAt)}
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
        <div role="status" aria-label="Loading reconciliation history">
          <Skeleton className="h-16 w-[180px]" />
        </div>
      ) : error ? (
        <div role="alert">
          <EmptyState
            icon={<WarningCircleIcon size={32} />}
            title="Reconciliation history unavailable"
            description="Failed to load reconciliation history."
            padding="sm"
          />
        </div>
      ) : !movements || movements.length === 0 ? (
        <EmptyState
          icon={<ArrowsClockwiseIcon size={32} />}
          title="No reconciliation history"
          description="No stock-takes or losses recorded yet."
          padding="sm"
        />
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
