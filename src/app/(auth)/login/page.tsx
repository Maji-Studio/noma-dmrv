/**
 * Login page
 * Handles user authentication via Better Auth
 */
import { LoginForm } from "@/components/auth";

export default function LoginPage() {
  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2 mb-32">Welcome back</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          Sign in to your account
        </p>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-[var(--radius-8)] border border-[var(--color-border-primary)] p-32 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
