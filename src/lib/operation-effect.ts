/** Transport-neutral write metadata. Never contains field values. */
export interface OperationEffect {
  outcome: "created" | "updated" | "deleted";
  entityType: string;
  entityIds: string[];
  versionBefore: number | null;
  versionAfter: number | null;
  changedFields: string[];
}
