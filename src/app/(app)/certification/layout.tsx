/**
 * Certification layout
 * Workspace shell for the /certification subtree: a shared tab band over the
 * active tab's content. The app shell (sidebar, FacilityProvider) and the
 * requireAuth guard are inherited from the parent (app) layout. The layout is
 * intentionally NOT admin-gated — operators use the hubs; Settings gates its
 * own admin-only sections. Provider-neutral by design: a future registry slots
 * in as sibling tabs here.
 */
import type { ReactNode } from "react";
import { CertificationTabBar } from "@/components/certification/certification-tab-bar";

export default function CertificationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <div className="bg-[var(--color-background-white)]">
        <div className="container-max">
          <CertificationTabBar />
        </div>
      </div>
      {children}
    </>
  );
}
