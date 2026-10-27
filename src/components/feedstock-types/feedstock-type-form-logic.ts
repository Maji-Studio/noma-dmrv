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

/** Tooltip on the Local category field in the Isometric flows. */
export const LOCAL_CATEGORY_HINT =
  "Used inside noma only, for example in bin and delivery subtitles. It is not sent to Isometric.";

/**
 * Picking a registry entry names a new type after it. A saved type keeps the
 * operator's own name; the registry name is shown next to it as the link.
 */
export function shouldOverwriteNameOnIsometricSelection(isEditMode: boolean): boolean {
  return !isEditMode;
}

export type IsometricLinkAction = "link" | "change" | "locked";

/**
 * What the Isometric field of a saved pyrolysis type offers: link an unlinked
 * type, change a link nothing has locked, or show the link read-only once a
 * sent Removal holds it. Nothing for a new type (the create flow has its own
 * picker) or a facility whose certifier is not Isometric.
 */
export function isometricLinkAction(input: {
  isEditMode: boolean;
  hasIsometricCertifier: boolean;
  usage: FeedstockTypeUsage | undefined;
  isLinked: boolean;
  isLocked: boolean;
}): IsometricLinkAction | null {
  if (!input.isEditMode || !input.hasIsometricCertifier || input.usage !== "pyrolysis") return null;
  if (input.isLocked && input.isLinked) return "locked";
  return input.isLinked ? "change" : "link";
}

/** The one line shown with a locked link. Names the Removal(s) it points at separately. */
export const ISOMETRIC_LINK_LOCKED_REASON =
  "This link is fixed because production runs of this feedstock type were sent in";
