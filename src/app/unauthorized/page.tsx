/**
 * Unauthorized page
 * Shown when user tries to access restricted areas
 */
import Link from "next/link";

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const displayReason = typeof reason === "string" && reason.length > 0 ? reason : null;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="title-heading-1 mb-24">Access Denied</h1>
        <p className="body-large mb-32 text-[var(--color-text-secondary)]">
          You do not have permission to access this page.
        </p>
        {displayReason ? (
          <p
            className="body-small mb-32 text-[var(--color-text-secondary)]"
            data-testid="unauthorized-reason"
          >
            Reason: {displayReason}
          </p>
        ) : null}
        <Link
          href="/"
          className="inline-block rounded-none bg-primary px-32 py-24 text-white hover:opacity-90"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
