/**
 * Shared bits of the manual entries in an open line: the ⋯ menu, the date
 * text, and Confirm for an entry that stopped counting.
 */
"use client";

import { useState } from "react";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, DropdownMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useConfirmEmissionEntry, type EmissionBatchScope } from "@/hooks/use-emission-entries";
import { formatDayString } from "@/lib/format-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import type { EmissionEntry, EmissionLine } from "./emission-line-display";

export interface EntryMenuItem { label: string; onSelect: () => void; destructive?: boolean }

export function EntryMenu({ label, items }: { label: string; items: EntryMenuItem[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        render={<Button variant="noOutline" size="icon" aria-label={label} className="size-44 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}
      >
        <DotsThreeVerticalIcon size={20} weight="bold" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {items.map((item) => (
          <DropdownMenu.Item key={item.label} destructive={item.destructive} onClick={item.onSelect}>
            {item.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

export function entryDateText(line: EmissionLine, entry: EmissionEntry): string {
  return line.entryPolicy === "single" ? "Whole credit batch" : formatDayString(entry.occurredOn);
}

/** Why a stopped entry no longer counts, and what clears it. */
export function stoppedEntryMessage(entry: EmissionEntry, canEnterAgain: boolean): string {
  if (entry.canConfirm) return "Stopped counting after a template change. It counts again once you confirm it.";
  if (canEnterAgain) return "Stopped counting after a template change. Enter the values again for the current line.";
  return "Stopped counting after a template change. This line takes no manual entries now, so delete the entry.";
}

/** Confirm for a stopped entry: the mutation, its toast and its error. */
export function useStoppedEntry(line: EmissionLine, entry: EmissionEntry, scope: EmissionBatchScope) {
  const toast = useToast();
  const confirm = useConfirmEmissionEntry(scope);
  const [error, setError] = useState<string | null>(null);
  const confirmEntry = async () => {
    setError(null);
    try {
      await confirm.mutateAsync({ id: entry.id, expectedVersion: entry.version });
      toast.success(`Manual entry confirmed on ${line.displayName}.`);
    } catch (caught) {
      setError(toSaveErrorMessage(caught, "The manual entry was not confirmed. Try again."));
    }
  };
  return { confirmEntry, confirming: confirm.isPending, error };
}
