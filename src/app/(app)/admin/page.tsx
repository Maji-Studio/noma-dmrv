/**
 * Admin — landing page
 * Tile grid linking to each admin configuration surface. Renders inside the
 * (app) shell (sidebar + facility context); access is gated by the parent
 * admin layout's requireAdmin() guard.
 */
import type { CSSProperties, ElementType } from "react";
import { ArrowRight, Gauge, Users } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";

interface AdminTile {
  href: string;
  icon: ElementType;
  title: string;
  description: string;
  /** Accent color token — drives the tile's icon, edge bar, and hover states. */
  accent: string;
}

const ADMIN_TILES: AdminTile[] = [
  {
    href: "/admin/emission-estimates",
    icon: Gauge,
    title: "Emission estimates",
    description:
      "Per-facility genset yield and process-stage energy split used when submitting credit batches to Isometric.",
    accent: "var(--clr-orange)",
  },
  {
    href: "/admin/users",
    icon: Users,
    title: "Users",
    description:
      "Invite and manage the people with access to the MRV system.",
    accent: "var(--clr-purple)",
  },
];

export default function AdminHomePage() {
  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <header className="flex flex-col gap-8">
        <h1 className="title-heading-2">Admin</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[560px]">
          System-wide settings and the constants that feed Isometric
          submissions. Choose an area to configure.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
        {ADMIN_TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card.Root
              key={tile.href}
              padding="none"
              radius="none"
              style={{ "--tile-accent": tile.accent } as CSSProperties}
            >
              <Card.Link href={tile.href} ariaLabel={tile.title}>
                <div className="relative flex h-full flex-col gap-16 p-24">
                  {/* Edge accent bar — echoes the sidebar's active indicator */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[2px] bg-[var(--tile-accent)] opacity-40 transition-opacity duration-200 group-hover:opacity-100"
                  />

                  {/* Icon */}
                  <span
                    aria-hidden
                    className="flex size-44 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--tile-accent)] transition-colors duration-200 group-hover:border-[var(--tile-accent)]"
                  >
                    <Icon size={22} weight="duotone" />
                  </span>

                  {/* Title + description */}
                  <div className="flex flex-col gap-8">
                    <h2 className="title-heading-3">{tile.title}</h2>
                    <p className="body-medium text-[var(--color-text-secondary)]">
                      {tile.description}
                    </p>
                  </div>

                  {/* Footer affordance */}
                  <div className="mt-auto flex items-center gap-8 pt-16">
                    <span className="title-chapter-title text-[var(--color-text-tertiary)] transition-colors duration-200 group-hover:text-[var(--color-text-primary)]">
                      Configure
                    </span>
                    <ArrowRight
                      aria-hidden
                      size={14}
                      weight="bold"
                      className="text-[var(--tile-accent)] transition-transform duration-200 group-hover:translate-x-[3px]"
                    />
                  </div>
                </div>
              </Card.Link>
            </Card.Root>
          );
        })}
      </div>
    </div>
  );
}
