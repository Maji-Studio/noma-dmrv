import type {
  CreditBatchFeedstockTypeFact,
} from "@/data-access/credit-batch-accounting-types";

export interface FeedstockTypeMappingGap {
  creditBatchId: string;
  creditBatchCode: string;
  feedstockTypeId: string;
  feedstockTypeName: string;
}

interface BatchFeedstockTypeFact {
  id: string;
  code: string;
  feedstockType?: CreditBatchFeedstockTypeFact;
}

export function collectFeedstockTypeMappingGaps(
  batches: BatchFeedstockTypeFact[],
): FeedstockTypeMappingGap[] {
  return batches.flatMap((batch) => {
    const feedstockType = batch.feedstockType;
    if (!feedstockType) return [];
    // Blend types are internal-only and never submitted. A credit batch should
    // declare pyrolysis usage; unknown usage fails closed for legacy data.
    if (
      feedstockType.usage === "blend" ||
      feedstockType.isometricFeedstockTypeId
    ) {
      return [];
    }
    return [
      {
        creditBatchId: batch.id,
        creditBatchCode: batch.code,
        feedstockTypeId: feedstockType.id,
        feedstockTypeName: feedstockType.name ?? feedstockType.id,
      },
    ];
  });
}

export function describeFeedstockTypeMappingGap(
  gap: FeedstockTypeMappingGap,
): string {
  return `Credit batch ${gap.creditBatchCode} uses pyrolysis feedstock type ${gap.feedstockTypeName}, which is not linked to an Isometric feedstock type. Edit ${gap.feedstockTypeName} in Feedstock types.`;
}
