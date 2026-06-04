/**
 * Certification — Settings
 * Consolidated configuration for a facility's registry integration: project
 * link, emission/LCA config, and environment health. Renders inside the (app)
 * shell; access is gated by the (app) layout's requireAuth() guard. The page
 * is NOT admin-gated — operators read the registry connection here; the
 * admin-only sections gate themselves client-side, backed by server-side
 * requireAdminAction guards.
 */
import { CertificationSettings } from "@/components/certification";

export default function CertificationSettingsPage() {
  return <CertificationSettings />;
}
