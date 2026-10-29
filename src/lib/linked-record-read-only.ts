import type { LinkedRecordFacility } from "@/hooks/use-linked-record-facility";

/**
 * A sheet whose record cannot change here at all (`EntitySideSheet`'s
 * `readOnly`). `info` when there is nothing to fix; `warning` with a retry
 * when a read failed and the sheet stays read only until it answers.
 */
export type SheetReadOnly = {
  tone: "info" | "warning";
  message: string;
  retry?: { run: () => void; running: boolean };
};

/**
 * Why a linked record's sheet is read only (#1499). An archived facility is
 * information (nothing to fix); a facility that could not be checked is a
 * warning with a Try again on the facility read. A record in an active
 * facility gets nothing.
 */
export function linkedRecordReadOnly(
  linked: LinkedRecordFacility,
  record: { facilityId?: string | null } | null | undefined,
  subject: string,
): SheetReadOnly | undefined {
  const readOnly = linked.readOnly;
  if (!readOnly || !record?.facilityId || record.facilityId !== readOnly.facilityId) return undefined;
  if (readOnly.reason === "archived") {
    return { tone: "info", message: `${readOnly.facilityName} is archived, so this ${subject} is read-only.` };
  }
  return {
    tone: "warning",
    message: `This ${subject}'s facility could not be checked, so it is read-only.`,
    retry: { run: readOnly.retry, running: readOnly.retrying },
  };
}
