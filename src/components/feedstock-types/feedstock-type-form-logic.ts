import { FEEDSTOCK_TYPE_USAGE_OPTIONS } from "@/schemas/feedstock-types";
import type { FeedstockTypeUsage } from "@/schemas/feedstock-types";

export const ISOMETRIC_FEEDSTOCK_REF_PREFIX = "isometric:feedstock_type:";

export function shouldShowIsometricFeedstockSection(
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
): boolean {
  return !(lockUsage && defaultUsage === "blend");
}

export function feedstockTypeUsageOptionsFor(
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
) {
  return lockUsage && defaultUsage
    ? FEEDSTOCK_TYPE_USAGE_OPTIONS.filter(
        (option) => option.value === defaultUsage,
      )
    : FEEDSTOCK_TYPE_USAGE_OPTIONS;
}

export function shouldSetUsageToPyrolysisForIsometricSelection(
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
): boolean {
  return !lockUsage || defaultUsage === "pyrolysis";
}

export function shouldClearCategoryForIsometricSelection(
  currentUsage: FeedstockTypeUsage | undefined,
): boolean {
  return currentUsage !== "pyrolysis";
}

export function isometricFeedstockRegistryRef(isometricId: string): string {
  return `${ISOMETRIC_FEEDSTOCK_REF_PREFIX}${isometricId}`;
}
