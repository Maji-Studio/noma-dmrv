import { GRAMS_PER_KG, massGrams } from "@/lib/calculations/gram-allocation";
import type { DerivedStatus, DerivedStatusKind } from "./status";

const STATUS_PRECEDENCE: readonly DerivedStatusKind[] = ["verification-failed", "issued", "verified"];

interface StatementStatusHolder {
  id: string;
  createdAt: Date | null;
  ghgStatementId: string | null;
  ghgStatementStatus: DerivedStatus | null;
}

/** Failure leads, then issued and verified; ties use the newest linked holder. */
export function batchStatementStatus(holders: readonly StatementStatusHolder[]): { id: string; status: DerivedStatus } | null {
  const linked = holders
    .filter(holder => holder.ghgStatementId !== null && holder.ghgStatementStatus !== null)
    .sort((a, b) => {
      if (a.createdAt === null && b.createdAt !== null) return 1;
      if (b.createdAt === null && a.createdAt !== null) return -1;
      return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) || b.id.localeCompare(a.id);
    });
  const deciding = STATUS_PRECEDENCE
    .map(kind => linked.find(holder => holder.ghgStatementStatus?.kind === kind))
    .find(holder => holder !== undefined) ?? linked[0];
  return deciding?.ghgStatementId && deciding.ghgStatementStatus
    ? { id: deciding.ghgStatementId, status: deciding.ghgStatementStatus }
    : null;
}

interface StatementPeriod {
  id: string;
  reportingPeriodEndOn: string | null;
  reportingPeriodStartOn: string | null;
}

function descendingNullable(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1;
  return b === null ? -1 : b.localeCompare(a);
}

/** One input row per holder, one output per statement, with this batch's mass only. */
export function aggregateBatchStatements<T extends StatementPeriod>(
  holders: readonly { ghgStatementId: string | null; dryKg: number }[],
  statements: readonly T[],
): (T & { dryKg: number })[] {
  const gramsByStatement = new Map<string, number>();
  for (const holder of holders) {
    if (holder.ghgStatementId === null) continue;
    const id = holder.ghgStatementId;
    gramsByStatement.set(id, (gramsByStatement.get(id) ?? 0) + massGrams(holder.dryKg));
  }
  return [...new Map(statements.map(statement => [statement.id, statement])).values()]
    .filter(statement => gramsByStatement.has(statement.id))
    .map(statement => ({ ...statement, dryKg: gramsByStatement.get(statement.id)! / GRAMS_PER_KG }))
    .sort((a, b) => descendingNullable(a.reportingPeriodEndOn, b.reportingPeriodEndOn)
      || descendingNullable(a.reportingPeriodStartOn, b.reportingPeriodStartOn)
      || b.id.localeCompare(a.id));
}
