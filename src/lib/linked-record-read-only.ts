import type { LinkedRecordFacility } from "@/hooks/use-linked-record-facility";

/**
 * Why a linked record's sheet is read only (#1499): its facility is archived,
 * or the facility could not be checked. The sheet shows it as its
 * `readOnlyReason`; a record in an active facility gets nothing.
 */
export function linkedRecordReadOnlyReason(
  linked: LinkedRecordFacility,
  record: { facilityId?: string | null } | null | undefined,
  subject: string,
): string | undefined {
  const readOnly = linked.readOnly;
  if (!readOnly || !record?.facilityId || record.facilityId !== readOnly.facilityId) return undefined;
  if (readOnly.reason === "archived") return `${readOnly.facilityName} is archived, so this ${subject} is read-only.`;
  return `This ${subject}'s facility could not be checked, so it is read-only. Refresh the page to try again.`;
}
