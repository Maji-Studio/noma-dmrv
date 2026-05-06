"use client";

import type { IsometricComponentBlueprint } from "@/lib/isometric";

interface BlueprintListProps {
  blueprints: IsometricComponentBlueprint[];
}

export function BlueprintList({ blueprints }: BlueprintListProps) {
  if (blueprints.length === 0) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        This template references no component blueprints.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border-tertiary)]">
      {blueprints.map((bp) => (
        <li key={bp.key} className="flex flex-col gap-4 py-12 first:pt-0">
          <div className="flex items-baseline justify-between gap-12">
            <h4 className="body-small font-medium">{bp.display_name}</h4>
            <code className="body-caption text-[var(--color-text-tertiary)] font-mono">
              {bp.key}
            </code>
          </div>
          {bp.description && (
            <p className="body-caption text-[var(--color-text-secondary)]">
              {bp.description}
            </p>
          )}
          {bp.inputs.length > 0 && (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {bp.inputs.length} input
              {bp.inputs.length === 1 ? "" : "s"}:{" "}
              {bp.inputs.map((i) => i.quantity_kind).join(", ")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
