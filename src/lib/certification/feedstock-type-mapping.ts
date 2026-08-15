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
    // Every batch that reaches certification needs a registry mapping. This
    // also fails closed for legacy blend/null usage records instead of letting
    // them reach production-batch construction with an empty type id list.
    if (feedstockType.isometricFeedstockTypeId) {
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
