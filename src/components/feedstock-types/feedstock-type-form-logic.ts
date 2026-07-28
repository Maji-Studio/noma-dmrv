import {
  FEEDSTOCK_TYPE_USAGE_OPTIONS,
  feedstockTypeUsages,
} from "@/schemas/feedstock-types";
import type { FeedstockTypeUsage } from "@/schemas/feedstock-types";

export function initialFeedstockTypeUsage(
  persistedUsage: string | undefined,
  defaultUsage: FeedstockTypeUsage | undefined,
): FeedstockTypeUsage | undefined {
  if (
    persistedUsage &&
    (feedstockTypeUsages as readonly string[]).includes(persistedUsage)
  ) {
    return persistedUsage as FeedstockTypeUsage;
  }

  return defaultUsage;
}

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

export function shouldShowCertifiedFeedstockWarning(
  isEditMode: boolean,
  usage: FeedstockTypeUsage | undefined,
  hasSelectedIsometricFeedstock: boolean,
): boolean {
  return (
    !isEditMode &&
    usage === "pyrolysis" &&
    !hasSelectedIsometricFeedstock
  );
}
