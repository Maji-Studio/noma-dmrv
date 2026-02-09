/**
 * Forgot password page
 * Allows users to request a password reset link
 */
import { ForgotPasswordForm } from "@/components/auth";

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2 mb-32">Forgot password?</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-[var(--radius-8)] border border-[var(--color-border-primary)] p-32 shadow-sm">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
