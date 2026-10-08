"use client";

import { FormError } from "@/components/forms";
import { Notice } from "@/components/ui";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import { API_PERMISSION_ACTIONS, API_PERMISSION_LABELS, API_PERMISSION_ROWS } from "./api-key-permissions";

interface ApiKeyPermissionGridProps {
  value: readonly ApiScope[];
  onChange: (value: ApiScope[]) => void;
  disabled?: boolean;
  error?: string;
}

export function ApiKeyPermissionGrid({ value, onChange, disabled, error }: ApiKeyPermissionGridProps) {
  return (
    <fieldset aria-describedby={error ? "api-key-permissions-note api-key-permissions-error" : "api-key-permissions-note"} aria-invalid={!!error} className="min-w-0 space-y-12" disabled={disabled}>
      <legend className="body-small font-medium">Permissions</legend>
      <Notice tone="warning" id="api-key-permissions-note">
        Delete allows the key to delete records. Select it only when needed.
      </Notice>
      <table className="w-full body-small border-collapse">
        <caption className="sr-only">API key permissions by entity</caption>
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)]">
            <th scope="col" className="py-8 text-left body-small font-medium text-[var(--color-text-secondary)]">Entity</th>
            {API_PERMISSION_ACTIONS.map((action) => (
              <th key={action} scope="col" className="py-8 text-center body-small font-medium text-[var(--color-text-secondary)]">
                {API_PERMISSION_LABELS[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {API_PERMISSION_ROWS.map((row) => (
            <tr key={row.entity} className="border-b border-[var(--color-border-tertiary)]">
              <th scope="row" className="py-8 pr-8 text-left font-normal">{row.label}</th>
              {API_PERMISSION_ACTIONS.map((action) => {
                const scope = row.scopes.find((scope) => scope === `${row.entity}:${action}`);
                return (
                  <td key={action} className={cn("text-center", scope && action === "delete" && "bg-[var(--st-bad-bg)]")}>
                    {scope ? (
                      <label className="inline-flex min-h-44 min-w-44 cursor-pointer items-center justify-center">
                        <span className="sr-only">{row.label} {API_PERMISSION_LABELS[action]}</span>
                        <input
                          type="checkbox"
                          checked={value.includes(scope)}
                          aria-describedby={action === "delete" ? "api-key-permissions-note" : undefined}
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
      <FormError id="api-key-permissions-error" message={error} />
    </fieldset>
  );
}
