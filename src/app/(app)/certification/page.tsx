/**
 * Certification — Overview (work queue)
 * The certification section's landing tab. Renders inside the (app) shell and
 * the certification layout's tab band; access is gated by the (app) layout's
 * requireAuth() guard. Operator-first: leads with what needs attention rather
 * than a vanity dashboard.
 */
import { CertificationOverview } from "@/components/certification";

export default function CertificationHomePage() {
  return <CertificationOverview />;
}
