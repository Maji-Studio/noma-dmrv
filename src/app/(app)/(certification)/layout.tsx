/**
 * Certification layout
 *
 * The route group wraps /removals and /ghg-statements in the registry guard.
 * Direct URL access redirects to Settings when the current facility has no
 * registry link. Settings lives outside this group so the link can be created.
 */
import type { ReactNode } from "react";
import { CertificationRegistryGuard } from "@/components/certification";

export default function CertificationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <CertificationRegistryGuard>{children}</CertificationRegistryGuard>;
}
