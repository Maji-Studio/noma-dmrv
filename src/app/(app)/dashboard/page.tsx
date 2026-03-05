/**
 * Dashboard Page
 * Main overview page — work in progress
 */
import { HardHat, Gauge, ChartLineUp, TreeStructure } from "@phosphor-icons/react/dist/ssr";

const UPCOMING_FEATURES = [
  {
    icon: Gauge,
    title: "Production Overview",
    description: "Real-time metrics across all facilities and reactors",
  },
  {
    icon: ChartLineUp,
    title: "Credit Analytics",
    description: "Track carbon credits from production to issuance",
  },
  {
    icon: TreeStructure,
    title: "Chain of Custody",
    description: "Visual traceability from feedstock to application",
  },
];

export default function DashboardPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-24">
      <div className="max-w-[520px] w-full text-center">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-80 h-80 mb-24 border-2 border-dashed border-[var(--color-border-secondary)]">
          <HardHat size={40} weight="duotone" className="text-[var(--color-text-tertiary)]" />
        </div>

        {/* Heading */}
        <h1 className="title-heading-1 mb-8">Dashboard</h1>
        <p className="body-large text-[var(--color-text-secondary)] mb-32">
          Work in progress. We&apos;re building your command center.
        </p>

        {/* Divider */}
        <div className="w-48 h-2 bg-[var(--color-border-primary)] mx-auto mb-32" />

        {/* Upcoming features */}
        <div>
          <p className="label-small uppercase tracking-wider text-[var(--color-text-tertiary)]">
            Coming soon
          </p>
          <ul className="text-left space-y-16">
            {UPCOMING_FEATURES.map((feature) => (
              <li
                key={feature.title}
                className="flex items-start gap-16 p-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]"
              >
                <feature.icon
                  size={24}
                  weight="duotone"
                  className="text-[var(--color-text-tertiary)] shrink-0 mt-2"
                />
                <div>
                  <p className="body-medium font-medium text-[var(--color-text-primary)]">
                    {feature.title}
                  </p>
                  <p className="body-small text-[var(--color-text-tertiary)]">
                    {feature.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
