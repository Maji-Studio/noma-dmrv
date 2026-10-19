"use client";

import { FormError } from "@/components/forms";
import { Notice } from "@/components/ui";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import { API_PERMISSION_ACTIONS, API_PERMISSION_LABELS, API_PERMISSION_ROWS } from "./api-key-permissions";

type PermissionAction = (typeof API_PERMISSION_ACTIONS)[number];

interface ApiKeyPermissionGridProps {
  value: readonly ApiScope[];
  onChange: (value: ApiScope[]) => void;
  disabled?: boolean;
  error?: string;
  /** Show only these scopes (rows without one are dropped). Defaults to every scope. */
  scopes?: readonly ApiScope[];
  /** Columns to show. Defaults to Read, Write and Delete. */
  actions?: readonly PermissionAction[];
  /** Prefix for the element ids, so two grids on one page do not collide. */
  idPrefix?: string;
  /** Names the table for screen readers. */
  caption?: string;
  /** Keeps the "Permissions" legend for screen readers only, when a heading above already says it. */
  hideLegend?: boolean;
}

export function ApiKeyPermissionGrid({
  value, onChange, disabled, error, scopes, actions: allActions = API_PERMISSION_ACTIONS,
  idPrefix = "api-key-permissions", caption = "API key permissions by entity", hideLegend = false,
}: ApiKeyPermissionGridProps) {
  const noteId = `${idPrefix}-note`;
  const errorId = `${idPrefix}-error`;
  const rows = API_PERMISSION_ROWS.filter((row) => !scopes || row.scopes.some((scope) => scopes.includes(scope)));
  // A restricted grid drops a column nobody asked for, so no header sits over empty cells.
  const actions = scopes ? allActions.filter((action) => scopes.some((scope) => scope.endsWith(`:${action}`))) : allActions;
  const showDelete = actions.includes("delete");
  return (
    <fieldset aria-describedby={showDelete ? (error ? `${noteId} ${errorId}` : noteId) : error ? errorId : undefined} aria-invalid={!!error} className="min-w-0 space-y-12" disabled={disabled}>
      <legend className={cn("body-small font-medium", hideLegend && "sr-only")}>Permissions</legend>
      {showDelete && (
        <Notice tone="warning" id={noteId}>
          Delete allows the key to delete records. Select it only when needed.
        </Notice>
      )}
      <table className="w-full body-small border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)]">
            <th scope="col" className="py-8 text-left body-small font-medium text-[var(--color-text-secondary)]">Entity</th>
            {actions.map((action) => (
              <th key={action} scope="col" className="py-8 text-center body-small font-medium text-[var(--color-text-secondary)]">
                {API_PERMISSION_LABELS[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entity} className="border-b border-[var(--color-border-tertiary)]">
              <th scope="row" className="py-8 pr-8 text-left font-normal">{row.label}</th>
              {actions.map((action) => {
                const scope = row.scopes.find((scope) => scope === `${row.entity}:${action}` && (!scopes || scopes.includes(scope)));
                return (
                  <td key={action} className={cn("text-center", scope && action === "delete" && "bg-[var(--st-bad-bg)]")}>
                    {scope ? (
                      <label className="inline-flex min-h-44 min-w-44 cursor-pointer items-center justify-center">
                        <span className="sr-only">{row.label} {API_PERMISSION_LABELS[action]}</span>
                        <input
                          type="checkbox"
                          checked={value.includes(scope)}
                          aria-describedby={action === "delete" ? noteId : undefined}
                          className={cn("size-16 cursor-pointer accent-[var(--color-interaction)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-interaction)]", action === "delete" && "accent-[var(--st-bad)]")}
                          onChange={(event) => onChange(event.target.checked ? [...value, scope] : value.filter((selected) => selected !== scope))}
                        />
                      </label>
                    ) : <span className="sr-only">{MISSING_VALUE.notApplicable}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <FormError id={errorId} message={error} />
    </fieldset>
  );
}
