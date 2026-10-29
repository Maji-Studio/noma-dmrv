import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";

export interface FeedstockTransportDraw {
  feedstockId: string;
  runId: string;
  startTime: Date;
  status: string | null;
}

/** Pick the earliest complete linked run from the caller's eligible candidates. */
export function feedstockTransportOwners(draws: readonly FeedstockTransportDraw[]): Map<string, string> {
  const firstDraws = new Map<string, FeedstockTransportDraw>();
  for (const draw of draws) {
    if (draw.status !== COMPLETED_PRODUCTION_RUN_STATUS) continue;
    const previous = firstDraws.get(draw.feedstockId);
    if (!previous || draw.startTime.getTime() < previous.startTime.getTime() ||
      (draw.startTime.getTime() === previous.startTime.getTime() && draw.runId < previous.runId)) {
      firstDraws.set(draw.feedstockId, draw);
    }
  }
  return new Map([...firstDraws].map(([id, draw]) => [id, draw.runId]));
}

type FeedstockTransportRun = {
  feedstocks: readonly { id: string; ownsTransport: boolean }[];
};

export function ownedTransportFeedstockIds(runs: readonly FeedstockTransportRun[]): string[] {
  return [...new Set(runs.flatMap((run) =>
    run.feedstocks.filter((feedstock) => feedstock.ownsTransport).map((feedstock) => feedstock.id),
  ))];
}

export function hasLinkedFeedstock(runs: readonly FeedstockTransportRun[]): boolean {
  return runs.some((run) => run.feedstocks.length > 0);
}
