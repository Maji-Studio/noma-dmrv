/**
 * Auth layout
 * Provides consistent layout for authentication pages
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background-light)]">
      <div className="max-w-md w-full">{children}</div>
    </div>
  );
}
