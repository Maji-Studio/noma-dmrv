/**
 * Certification — GHG Statements
 * App-native DataTable of GHG Statements for the selected facility, with a
 * read-only quick view (`?statement=<id>`) and a period-first create drawer.
 * Protected by the requireAuth guard in the (app) layout.
 */
import { GhgStatementsList } from "@/components/certification/ghg-statements-list";

export default function CertificationGhgStatementsPage() {
  return <GhgStatementsList />;
}
