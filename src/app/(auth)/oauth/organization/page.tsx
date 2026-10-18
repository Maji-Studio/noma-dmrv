/**
 * OAuth organization picker: the person chooses which organization an app acts
 * for. Reached from the provider's authorize step, never linked from the app.
 */
import { Suspense } from "react";
import { OrganizationPicker } from "@/components/oauth/organization-picker";

export default function OAuthOrganizationPage() {
  return (
    <Suspense>
      <OrganizationPicker />
    </Suspense>
  );
}
