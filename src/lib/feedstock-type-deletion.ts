import type { ConflictRef } from "@/lib/conflict-ref";

export type FeedstockTypeDeleteConflict = ConflictRef;

export function getFeedstockTypeDeleteDecision(
  conflicts: FeedstockTypeDeleteConflict[],
):
  | { action: "delete" }
  | { action: "conflict"; conflict: FeedstockTypeDeleteConflict } {
  const conflict = conflicts[0];
  return conflict ? { action: "conflict", conflict } : { action: "delete" };
}
