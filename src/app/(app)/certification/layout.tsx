/**
 * Certification layout
 * Thin boundary for the /certification route subtree. The app shell
 * (sidebar, FacilityProvider) and the requireAuth guard are inherited from
 * the parent (app) layout. This boundary exists so future per-provider
 * guards (Verra / Gold Standard / CSI) have a place to live.
 */
import type { ReactNode } from "react";

export default function CertificationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
