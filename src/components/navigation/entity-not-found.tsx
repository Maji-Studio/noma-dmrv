"use client";

import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const ICON_SIZE = 48;

interface EntityNotFoundProps {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}

export function EntityNotFound({
  title,
  description,
  backHref,
  backLabel,
}: EntityNotFoundProps) {
  return (
    <div className="container-max page-shell">
      <EmptyState
        icon={<MagnifyingGlassIcon size={ICON_SIZE} />}
        title={title}
        description={description}
        action={
          <Link
            href={backHref}
            className={buttonVariants({ variant: "primary" })}
          >
            {backLabel}
          </Link>
        }
      />
    </div>
  );
}
