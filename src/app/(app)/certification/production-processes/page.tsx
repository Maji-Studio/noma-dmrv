/**
 * Production Processes List Page (ADR 0017 Track 1.5)
 * Operator surface for per-feedstock sampling campaigns + the Method-B unlock.
 *
 * Lives under the `certification` segment so it inherits
 * `CertificationRegistryGuard` (certification/layout.tsx): direct URL access at a
 * facility with no registry link redirects to Settings, exactly like Removals /
 * GHG Statements. A facility off the registry has no Method A/B to manage, so the
 * list and its unlock/start-process actions stay gated, not just nav-hidden.
 * Also protected by the requireAuth guard in the (app) layout.
 */
import { getOrgContext } from "@/lib/auth/server";
import { ProductionProcessList } from "@/components/production-processes";

export default async function ProductionProcessesPage() {
  // Owners/admins (and Platform Admins) may correct a process's operational
  // start; mirror the org-settings gate. The server action re-checks the role.
  const ctx = await getOrgContext();
  const canManage =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin");

  return <ProductionProcessList canManage={canManage} />;
}
