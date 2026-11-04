/**
 * Login page
 * Handles user authentication via Better Auth
 */
import { Suspense } from "react";
import { LoginForm } from "@/components/auth";

export default function LoginPage() {
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
