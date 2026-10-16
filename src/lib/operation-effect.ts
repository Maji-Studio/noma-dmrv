/** Transport-neutral write metadata. Never contains field values; those live only in activity_events.changes. */
export interface OperationEffect {
  outcome: "created" | "updated" | "deleted";
  entityType: string;
  entityIds: string[];
  versionBefore: number | null;
  versionAfter: number | null;
  changedFields: string[];
}
