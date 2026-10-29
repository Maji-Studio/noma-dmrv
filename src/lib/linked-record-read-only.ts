import type { LinkedRecordFacility } from "@/hooks/use-linked-record-facility";

/**
 * Why a linked record's sheet is read only (#1499): its facility is archived.
 * The sheet shows it as its `readOnlyReason`; a record in an active facility
 * gets nothing and stays writable.
 */
export function archivedFacilityReadOnlyReason(
  linked: LinkedRecordFacility,
  record: { facilityId?: string | null } | null | undefined,
  subject: string,
): string | undefined {
  const facility = linked.archivedFacility;
  if (!facility || !record?.facilityId || record.facilityId !== facility.id) return undefined;
  return `${facility.name} is archived, so this ${subject} is read-only.`;
}
