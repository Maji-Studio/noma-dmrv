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
import { ProductionProcessList } from "@/components/production-processes";

export default function ProductionProcessesPage() {
  return <ProductionProcessList />;
}
