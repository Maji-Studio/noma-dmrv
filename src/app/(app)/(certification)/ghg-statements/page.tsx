/**
 * Certification — GHG Statements
 * App-native DataTable of GHG Statements for the selected facility, with a
 * read-only detail Modal (`?statement=<id>`) and a period-first create dialog.
 * Protected by the requireAuth guard in the (app) layout.
 */
import { GhgStatementsList } from "@/components/certification/ghg-statements-list";
import { getOrgContext } from "@/lib/auth/server";

export default async function CertificationGhgStatementsPage() {
  const ctx = await getOrgContext();
  const canManage = !!ctx && (ctx.isPlatformAdmin || ctx.orgRole === "admin");
  return <GhgStatementsList canManage={canManage} />;
}
