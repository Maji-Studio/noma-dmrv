/**
 * Login page
 * Handles user authentication via Better Auth
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth";
import { hasAnyUser } from "@/data-access/first-run";

// The first-run check must run on every request, never at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await hasAnyUser())) redirect("/setup");

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2">Welcome back</h1>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 shadow-sm">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
