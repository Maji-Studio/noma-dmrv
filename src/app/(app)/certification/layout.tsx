/**
 * Certification layout
 *
 * Wraps every certification route in the registry guard so direct URL access to
 * the operational routes (Removals, GHG Statements) redirects to
 * Settings when the current facility has no registry link. Settings itself is
 * exempt inside the guard — it's where the link is created.
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
