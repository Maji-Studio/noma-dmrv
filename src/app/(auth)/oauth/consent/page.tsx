/**
 * OAuth consent: the person allows or denies the permissions an app asks for.
 * Reached from the provider's authorize step, never linked from the app.
 */
import { Suspense } from "react";
import { ConsentForm } from "@/components/oauth/consent-form";

export default function OAuthConsentPage() {
  return (
    <Suspense>
      <ConsentForm />
    </Suspense>
  );
}
