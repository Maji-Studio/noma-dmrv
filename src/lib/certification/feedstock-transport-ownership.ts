export interface FeedstockTransportDraw {
  feedstockId: string;
  runId: string;
  startTime: Date;
  status: string | null;
}

/** Transport is front-loaded onto the first real draw, regardless of batch membership. */
export function feedstockTransportOwners(draws: readonly FeedstockTransportDraw[]): Map<string, string> {
  const firstDraws = new Map<string, FeedstockTransportDraw>();
  for (const draw of draws) {
    if (draw.status === "cancelled") continue;
    const previous = firstDraws.get(draw.feedstockId);
    if (!previous || draw.startTime.getTime() < previous.startTime.getTime() ||
      (draw.startTime.getTime() === previous.startTime.getTime() && draw.runId < previous.runId)) {
      firstDraws.set(draw.feedstockId, draw);
    }
  }
  return new Map([...firstDraws].map(([id, draw]) => [id, draw.runId]));
}
