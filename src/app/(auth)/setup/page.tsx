/**
 * First-run setup page
 * Creates the first Platform Admin while no user exists, then sends everyone to sign in.
 */
import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth";
import { hasAnyUser } from "@/data-access/first-run";

// The user check must run on every request, never at build time.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2">Set up noma dMRV</h1>
        <p className="body-medium text-[var(--color-text-secondary)] mt-8">
          Choose the email and password for the first Platform Admin account.
        </p>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 shadow-sm">
        <SetupForm />
      </div>
    </div>
  );
}
