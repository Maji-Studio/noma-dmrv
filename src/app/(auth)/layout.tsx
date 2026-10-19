/**
 * Auth layout
 * Provides consistent layout for authentication pages
 */
import { NomaLogo } from "@/components/ui/noma-logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="max-w-md w-full">
        <NomaLogo
          title="noma"
          className="mx-auto mb-32 block size-64 text-[var(--color-text-primary)]"
        />
        {children}
      </div>
    </div>
  );
}
