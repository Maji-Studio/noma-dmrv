"use client";

import {
  PlantIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import type { Application } from "@/db/schema/application";
import {
  formatApplicationMethod,
} from "@/schemas/applications";
import { formatDate } from "@/lib/format-utils";
import { formatApplicationKgFromTons } from "./mass-utils";

interface ApplicationCardProps {
  application: Application;
  onView?: (application: Application) => void;
  onEdit?: (application: Application) => void;
  onDelete?: (applicationId: string) => void;
}

export function ApplicationCard({
  application,
  onView,
  onEdit,
  onDelete,
}: ApplicationCardProps) {
  return (
    <article
      className={`flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors${onView ? " hover:border-[var(--color-border-primary)] cursor-pointer" : ""}`}
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      onClick={onView ? () => onView(application) : undefined}
      onKeyDown={onView ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView(application);
        }
      } : undefined}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* Header: code badge */}
        <div className="flex items-center gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-rose-20)] bg-[var(--clr-rose-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-pink)]">
            <PlantIcon size={12} weight="bold" />
            {application.code}
          </span>
        </div>

        {/* Date + method */}
        <div>
          <h3 className="title-heading-3 text-[var(--color-text-primary)]">
            {formatDate(application.applicationDate)}
          </h3>
          {application.applicationMethodType && (
            <p className="mt-6 body-caption text-[var(--color-text-tertiary)]">
              {formatApplicationMethod(application.applicationMethodType as "manual" | "mechanical")}
              {application.fieldIdentifier && ` · ${application.fieldIdentifier}`}
            </p>
          )}
        </div>

        {/* 3-col metrics */}
        <div className="grid grid-cols-3 gap-12">
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Biochar
            </p>
            <p className="title-heading-3">
              {formatApplicationKgFromTons(application.biocharAppliedTons)}
            </p>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Dry Mass
            </p>
            <p className="body-small text-[var(--color-text-primary)]">
              {formatApplicationKgFromTons(application.biocharAppliedDryTons)}
            </p>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Field Size
            </p>
            <p className="body-small text-[var(--color-text-primary)]">
              {application.fieldSizeHa != null
                ? `${application.fieldSizeHa.toFixed(2)} ha`
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {application.cropType || "No crop type"}
        </span>

        {(onEdit || onDelete) && (
          <div className="flex items-center gap-8" onClick={(e) => e.stopPropagation()}>
            {onEdit && (
              <Button size="small" variant="default" onClick={() => onEdit(application)}>
                <PencilSimpleIcon size={16} />
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                size="small"
                variant="default"
                className="border-[var(--color-signal-red)] text-[var(--color-signal-red)] hover:bg-[var(--clr-red-10)]"
                onClick={() => onDelete(application.id)}
                aria-label="Delete application"
              >
                <TrashIcon size={16} />
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
