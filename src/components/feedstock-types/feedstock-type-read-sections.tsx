/** Feedstock type side-sheet view mode: the sections config for EntitySideSheet. */
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { FeedstockType } from "@/db/schema";
import { IsometricLink } from "@/components/certification/isometric-link";
import { isometricRegistry } from "@/lib/isometric/links";
import { FeedstockTypeSampling } from "./feedstock-type-sampling";

/** "wood_chips" → "Wood Chips". */
export function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** `sampling` is set when the facility can run feedstock sampling for this type. */
export function feedstockTypeSheetSections(
  feedstockType: FeedstockType,
  sampling: { facilityId: string; canManage: boolean } | null,
  /** Registry environment for the Certify link; sandbox when unknown. */
  isProduction = false,
): DetailPanelSection[] {
  return [
    {
      title: "Catalogue",
      fields: [
        { label: "Name", value: feedstockType.name },
        { label: "Code", value: feedstockType.code },
        { label: "Category", value: titleCase(feedstockType.category) },
        { label: "Usage", value: feedstockType.usage === "blend" ? "Blend" : "Pyrolysis" },
        { label: "State", value: feedstockType.archivedAt ? "Archived" : "Active" },
        {
          label: "Isometric feedstock ID",
          value: feedstockType.isometricFeedstockTypeId ? (
            <span className="inline-flex items-center gap-4">
              <span className="font-mono">{feedstockType.isometricFeedstockTypeId}</span>
              <IsometricLink
                href={isometricRegistry.feedstockType({
                  environment: isProduction ? "production" : "sandbox",
                  isometricFeedstockTypeId: feedstockType.isometricFeedstockTypeId,
                })}
              />
            </span>
          ) : null,
        },
        { label: "Registry URL", value: feedstockType.registryUrl },
        { label: "Description", value: feedstockType.description },
      ],
    },
    ...(sampling
      ? [{
          title: "Sampling",
          fields: [],
          content: (
            <FeedstockTypeSampling
              facilityId={sampling.facilityId}
              feedstockTypeId={feedstockType.id}
              canManage={sampling.canManage}
            />
          ),
        }]
      : []),
  ];
}
