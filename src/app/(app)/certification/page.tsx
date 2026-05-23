/**
 * Certification — Isometric Removals hub
 * Lists every Removal for the selected facility, its member credit batches
 * and submission status, and lets the user group batches and submit.
 * Protected by the requireAuth guard in the (app) layout.
 */
import { RemovalsHub } from "@/components/certification/removals-hub";

export default function CertificationPage() {
  return <RemovalsHub />;
}
