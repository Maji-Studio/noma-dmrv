export interface FeedstockTypeDeleteConflict {
  entity: string;
  id: string;
  code: string;
}

export function getFeedstockTypeDeleteDecision(
  conflicts: FeedstockTypeDeleteConflict[],
):
  | { action: "delete" }
  | { action: "conflict"; conflict: FeedstockTypeDeleteConflict } {
  const conflict = conflicts[0];
  return conflict ? { action: "conflict", conflict } : { action: "delete" };
}
