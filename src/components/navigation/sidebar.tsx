"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, List, Gear } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

interface SidebarProps {
  projectId: string;
}

export function Sidebar({ projectId }: SidebarProps) {
  const pathname = usePathname();

  const links = [
    {
      href: `/${projectId}/dashboard`,
      label: "Dashboard",
      icon: House,
    },
    {
      href: `/${projectId}/items`,
      label: "Items",
      icon: List,
    },
    {
      href: `/${projectId}/settings`,
      label: "Settings",
      icon: Gear,
    },
  ];

  return (
    <aside className="w-64 border-r border-[var(--color-border-primary)] min-h-screen p-l bg-[var(--color-background-light)]">
      <nav className="flex flex-col gap-xs">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-s px-m py-s rounded-[var(--radius-8)] transition-colors duration-300",
                isActive
                  ? "bg-[var(--clr-dark-purple)] text-[var(--color-text-white-primary)]"
                  : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-medium)]"
              )}
            >
              <Icon size={20} weight={isActive ? "fill" : "regular"} />
              <span className="body-medium">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
