import {
  FEEDSTOCK_TYPE_USAGE_OPTIONS,
  feedstockTypeUsages,
} from "@/schemas/feedstock-types";
import type { FeedstockTypeUsage } from "@/schemas/feedstock-types";

export type FeedstockTypeSection = "general" | "isometric";

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
  hasIsometricCertifier: boolean,
  lockUsage: boolean,
  defaultUsage: FeedstockTypeUsage | undefined,
): boolean {
  return (
    hasIsometricCertifier && !(lockUsage && defaultUsage === "blend")
  );
}

export function visibleFeedstockTypeSection(
  activeSection: FeedstockTypeSection,
  showIsometricSection: boolean,
): FeedstockTypeSection {
  return activeSection === "isometric" && !showIsometricSection
    ? "general"
    : activeSection;
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
  hasIsometricCertifier: boolean,
  isEditMode: boolean,
  usage: FeedstockTypeUsage | undefined,
  hasSelectedIsometricFeedstock: boolean,
): boolean {
  return (
    hasIsometricCertifier &&
    !isEditMode &&
    usage === "pyrolysis" &&
    !hasSelectedIsometricFeedstock
  );
}
