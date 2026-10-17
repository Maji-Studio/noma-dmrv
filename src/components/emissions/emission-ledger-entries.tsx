/**
 * The manual entries inside the line drawer's ledger: each counting entry
 * with its own ⋯ (Edit, Add file, Delete), entries that stopped counting
 * (Confirm or Enter again).
 */
"use client";

import { useState } from "react";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms/server-error";
import { Button, DropdownMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useConfirmEmissionEntry, type EmissionBatchScope } from "@/hooks/use-emission-entries";
import { formatDayString } from "@/lib/format-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { EntryFileNames, EntryFileUpload } from "./emission-entry-files";
import { entryFigureText, type EmissionEntry, type EmissionLine } from "./emission-line-display";

interface EntryMenuItem { label: string; onSelect: () => void; destructive?: boolean }

function EntryMenu({ label, items }: { label: string; items: EntryMenuItem[] }) {
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

function entryDateText(line: EmissionLine, entry: EmissionEntry): string {
  return line.entryPolicy === "single" ? "Whole credit batch" : formatDayString(entry.occurredOn);
}

interface ManualEntryItemProps {
  line: EmissionLine;
  entry: EmissionEntry;
  scope: EmissionBatchScope;
  /** False while manual entries are switched off: no entry menu or write buttons. */
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function ManualEntryItem({ line, entry, scope, canWrite, onEdit, onDelete }: ManualEntryItemProps) {
  const [addingFile, setAddingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dateText = entryDateText(line, entry);
  const items: EntryMenuItem[] = [
    { label: "Edit", onSelect: onEdit },
    { label: "Add file", onSelect: () => setAddingFile(true) },
    { label: "Delete", onSelect: onDelete, destructive: true },
  ];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-8 py-10 [border-top:var(--row-divider)] first:pt-0 first:[border-top:none]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-12">
          <span className="body-small text-[var(--color-text-secondary)]">{dateText}</span>
          <span className="body-small font-medium tabular-nums">{entryFigureText(entry)}</span>
        </div>
        <EntryFileNames entry={entry} />
        {entry.note && <p className="body-caption text-[var(--color-text-secondary)]">{entry.note}</p>}
        {addingFile ? (
          <div className="flex flex-col gap-8 pt-4">
            <EntryFileUpload
              id={`entry-file-${entry.id}`}
              entry={entry}
              scope={scope}
              onUploaded={() => setAddingFile(false)}
              onError={setUploadError}
            />
            {uploadError && <ServerError message={uploadError} />}
            <div>
              <Button size="small" variant="weak" onClick={() => setAddingFile(false)}>Done</Button>
            </div>
          </div>
        ) : (
          canWrite && entry.documentCount === 0 && (
            <div>
              <Button size="small" variant="weak" onClick={() => setAddingFile(true)}>Add file</Button>
            </div>
          )
        )}
      </div>
      {canWrite && <EntryMenu label={`Actions for the manual entry, ${dateText}`} items={items} />}
    </li>
  );
}

interface StoppedEntryItemProps {
  line: EmissionLine;
  entry: EmissionEntry;
  scope: EmissionBatchScope;
  canWrite: boolean;
  /** False when the line takes no new entries (removed from the template): only Delete clears it. */
  canEnterAgain: boolean;
  onEnterAgain: () => void;
  onDelete: () => void;
}

/** An entry that stopped counting after a template change: struck through, with Confirm or Enter again. */
export function StoppedEntryItem({ line, entry, scope, canWrite, canEnterAgain, onEnterAgain, onDelete }: StoppedEntryItemProps) {
  const toast = useToast();
  const confirm = useConfirmEmissionEntry(scope);
  const [error, setError] = useState<string | null>(null);
  const dateText = entryDateText(line, entry);
  const confirmEntry = async () => {
    setError(null);
    try {
      await confirm.mutateAsync({ id: entry.id, expectedVersion: entry.version });
      toast.success(`Manual entry confirmed on ${line.displayName}.`);
    } catch (caught) {
      setError(toSaveErrorMessage(caught, "The manual entry was not confirmed. Try again."));
    }
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-8 py-10 [border-top:var(--row-divider)] first:pt-0 first:[border-top:none]">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-12 text-[var(--color-text-tertiary)]">
          <span className="body-small">{dateText}</span>
          <span className="body-small tabular-nums line-through">{entryFigureText(entry)}</span>
        </div>
        <p className="body-caption text-[var(--st-wait)]">
          {entry.canConfirm
            ? "Stopped counting after a template change. It counts again once you confirm it."
            : canEnterAgain
              ? "Stopped counting after a template change. Enter the values again for the current line."
              : "Stopped counting after a template change. This line takes no manual entries now, so delete the entry."}
        </p>
        <div className="flex flex-wrap gap-8">
          {!canWrite ? null : entry.canConfirm ? (
            <Button size="small" variant="primary" busy={confirm.isPending} onClick={() => void confirmEntry()}>Confirm</Button>
          ) : (
            canEnterAgain && <Button size="small" variant="primary" onClick={onEnterAgain}>Enter again</Button>
          )}
        </div>
        {error && <ServerError message={error} />}
      </div>
      {canWrite && <EntryMenu label={`Actions for the stopped manual entry, ${dateText}`} items={[{ label: "Delete", onSelect: onDelete, destructive: true }]} />}
    </li>
  );
}
