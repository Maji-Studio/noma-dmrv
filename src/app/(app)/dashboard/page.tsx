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
    <div className="flex-1 flex items-center justify-center p-24 h-full">
      <div className="max-w-[520px] w-full text-center ">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-80 h-80 mb-24 border-2 border-dashed border-[var(--color-border-secondary)]">
          <HardHat size={40} weight="duotone" className="text-[var(--color-text-tertiary)]" />
        </div>

        {/* Heading */}
        <h1 className="title-heading-1 mb-8">Dashboard</h1>
        <p className="body-large text-[var(--color-text-secondary)] mb-32">Work in progress. ✌️</p>

        {/* Divider */}
        <div className="w-48 h-2 bg-[var(--color-border-primary)] mx-auto mb-32" />
      </div>
    </div>
  );
}
