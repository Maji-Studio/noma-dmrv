import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

interface DashboardPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { projectId } = await params;

  return (
    <div className="space-y-l">
      <div>
        <h1 className="title-heading-1">Dashboard</h1>
        <p className="body-large text-[var(--color-text-secondary)] mt-s">
          Welcome to your project dashboard
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-m">
        <Link
          href={`/${projectId}/items`}
          className="group p-l border border-[var(--color-border-primary)] rounded-lg hover:border-[var(--clr-dark-purple)] transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="title-heading-3 mb-s">Items</h2>
              <p className="body-small text-[var(--color-text-secondary)]">
                Manage your project items
              </p>
            </div>
            <ArrowRight
              size={24}
              className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors"
            />
          </div>
        </Link>

        <Link
          href={`/${projectId}/settings`}
          className="group p-l border border-[var(--color-border-primary)] rounded-lg hover:border-[var(--clr-dark-purple)] transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="title-heading-3 mb-s">Settings</h2>
              <p className="body-small text-[var(--color-text-secondary)]">
                Configure your project
              </p>
            </div>
            <ArrowRight
              size={24}
              className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors"
            />
          </div>
        </Link>
      </div>
    </div>
  );
}
