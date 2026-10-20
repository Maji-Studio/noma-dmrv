/**
 * Set password page
 * Used for initial password setup from admin invite
 */
import { Suspense } from "react";
import { SetPasswordForm } from "@/components/auth";

export default function SetPasswordPage() {
  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2">Welcome!</h1>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 shadow-sm">
        <Suspense
          fallback={
            <div className="text-center py-32 text-[var(--color-text-secondary)]">
              Loading...
            </div>
          }
        >
          <SetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
