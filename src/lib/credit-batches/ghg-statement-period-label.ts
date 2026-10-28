import { formatDate, formatDateRange } from "@/lib/format-utils";

interface GhgStatementPeriod {
  reportingPeriodStartOn: string | null;
  reportingPeriodEndOn: string | null;
  hasMissingPeriod: boolean;
}

export function ghgStatementPeriodLabel(statement: GhgStatementPeriod): string {
  if (statement.hasMissingPeriod) return "No period set";
  if (statement.reportingPeriodStartOn) {
    return formatDateRange(
      statement.reportingPeriodStartOn,
      statement.reportingPeriodEndOn,
    );
  }
  return `Ends ${formatDate(statement.reportingPeriodEndOn)}`;
}
