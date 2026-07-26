"use client";

import { useEffect, useRef } from "react";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";
import {
  productionRunTimingDefaults,
  resolveProductionRunTimingZoneSync,
  type ProductionRunTimingField,
} from "./production-run-timing";

type ResetTimingField = (
  name: ProductionRunTimingField,
  options: { defaultValue: string },
) => void;

/**
 * Re-seed clean timing fields when async facility resolution changes their
 * zone, while preserving any wall-clock value the operator has edited.
 */
export function useProductionRunTimingZoneSync(args: {
  timeZone: string;
  productionRun?: ProductionRunWithRelations;
  dirtyFields: Partial<Record<ProductionRunTimingField, boolean>>;
  resetField: ResetTimingField;
}) {
  const { dirtyFields, productionRun, resetField, timeZone } = args;
  const previousTimeZoneRef = useRef(timeZone);
  const startDateDirty = !!dirtyFields.startDate;
  const startTimeDirty = !!dirtyFields.startTime;
  const endDateDirty = !!dirtyFields.endDate;
  const endTimeDirty = !!dirtyFields.endTime;

  useEffect(() => {
    const previousTimeZone = previousTimeZoneRef.current;
    const transition = resolveProductionRunTimingZoneSync(
      previousTimeZone,
      timeZone,
      {
        startDate: startDateDirty,
        startTime: startTimeDirty,
        endDate: endDateDirty,
        endTime: endTimeDirty,
      },
    );
    previousTimeZoneRef.current = transition.trackedTimeZone;
    if (!transition.shouldReset) return;

    const defaults = productionRunTimingDefaults(
      productionRun,
      timeZone,
    );
    resetField("startDate", { defaultValue: defaults.startDate });
    resetField("startTime", { defaultValue: defaults.startTime });
    resetField("endDate", { defaultValue: defaults.endDate });
    resetField("endTime", { defaultValue: defaults.endTime });
  }, [
    productionRun,
    resetField,
    timeZone,
    endDateDirty,
    endTimeDirty,
    startDateDirty,
    startTimeDirty,
  ]);
}
