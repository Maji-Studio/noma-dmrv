/** Transport-neutral write metadata. Never contains field values; those live only in activity_events.changes. */
export interface OperationEffect {
  outcome: "created" | "updated" | "deleted" | "status_changed";
  fromStatus?: string;
  toStatus?: string;
  entityType: string;
  entityIds: string[];
  versionBefore: number | null;
  versionAfter: number | null;
  changedFields: string[];
}

/** Writers describe identity and versions; the runner derives changed fields. */
export type OperationDescription = Omit<OperationEffect, "changedFields">;
