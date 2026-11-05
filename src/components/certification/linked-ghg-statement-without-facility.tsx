"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { GHG_STATEMENT_DEEP_LINK_PARAM } from "@/lib/record-links";
import { GhgStatementDetailSheet } from "./ghg-statement-detail-sheet";
import { useLinkedGhgStatement } from "./use-linked-ghg-statement";

/**
 * The page with no active facility still opens a `?statement=` link into an
 * archived facility, read only (credit batches do the same). A link into an
 * active facility switches to it, so the list takes over.
 */
export function LinkedGhgStatementWithoutFacility({ canManage }: { canManage: boolean }) {
  const [statementId, setStatementId] = useQueryState(
    GHG_STATEMENT_DEEP_LINK_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const { linkedState, readOnly, timeZone } = useLinkedGhgStatement(statementId, !!statementId, setStatementId);
  // The environment is deployment-wide, but this page has no working facility to read it from, so
  // read the linked one. The sheet waits for it rather than flash the Sandbox banner.
  const summary = useFacilityCertifierSummary(linkedState?.statement.facilityId ?? "", !!readOnly);
  if (!linkedState || !readOnly || !summary.data) return null;
  return (
    <GhgStatementDetailSheet
      item={linkedState}
      isProduction={summary.data.isProduction}
      canManageReports={canManage}
      readOnly={readOnly}
      timeZone={timeZone}
      open
      onClose={() => setStatementId(null)}
    />
  );
}
