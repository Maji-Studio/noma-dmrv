import Link from "next/link";
import { ArrowRight, Warehouse, Factory, ShoppingCart, Certificate } from "@phosphor-icons/react/dist/ssr";
import { DashboardStats } from "@/components/dashboard";

interface DashboardPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { projectId } = await params;

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <div>
        <h1 className="title-heading-2">Dashboard</h1>
        <p className="body-large text-[var(--color-text-secondary)] mt-8">
          Welcome to your project dashboard
        </p>
      </div>

      {/* Key Metrics */}
      <section>
        <h2 className="title-heading-3 mb-24">Key Metrics</h2>
        <DashboardStats projectId={projectId} />
      </section>

      {/* Quick Links */}
      <section>
        <h2 className="title-heading-3 mb-24">Quick Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
          <Link
            href="/facilities"
            className="group p-24 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] hover:border-[var(--clr-dark-purple)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-16">
                <Warehouse size={24} weight="bold" className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors" />
                <div>
                  <h3 className="title-heading-3 mb-4">Facilities</h3>
                  <p className="body-small text-[var(--color-text-secondary)]">
                    Manage production facilities
                  </p>
                </div>
              </div>
              <ArrowRight
                size={24}
                className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors"
              />
            </div>
          </Link>

          <Link
            href="/production-runs"
            className="group p-24 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] hover:border-[var(--clr-dark-purple)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-16">
                <Factory size={24} weight="bold" className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors" />
                <div>
                  <h3 className="title-heading-3 mb-4">Production Runs</h3>
                  <p className="body-small text-[var(--color-text-secondary)]">
                    Track pyrolysis batches
                  </p>
                </div>
              </div>
              <ArrowRight
                size={24}
                className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors"
              />
            </div>
          </Link>

          <Link
            href="/orders"
            className="group p-24 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] hover:border-[var(--clr-dark-purple)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-16">
                <ShoppingCart size={24} weight="bold" className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors" />
                <div>
                  <h3 className="title-heading-3 mb-4">Orders</h3>
                  <p className="body-small text-[var(--color-text-secondary)]">
                    Manage biochar orders
                  </p>
                </div>
              </div>
              <ArrowRight
                size={24}
                className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors"
              />
            </div>
          </Link>

          <Link
            href="/credit-batches"
            className="group p-24 border border-[var(--color-border-primary)] rounded-[var(--radius-8)] hover:border-[var(--clr-dark-purple)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-16">
                <Certificate size={24} weight="bold" className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors" />
                <div>
                  <h3 className="title-heading-3 mb-4">Credit Batches</h3>
                  <p className="body-small text-[var(--color-text-secondary)]">
                    Track carbon credits
                  </p>
                </div>
              </div>
              <ArrowRight
                size={24}
                className="text-[var(--color-text-secondary)] group-hover:text-[var(--clr-dark-purple)] transition-colors"
              />
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
