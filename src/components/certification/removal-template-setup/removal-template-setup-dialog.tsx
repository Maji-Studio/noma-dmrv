/**
 * Removal template setup dialog (#1276): a stepper over the Settings Removal
 * templates pane, opened from the summary card. Reads the facility's templates
 * live from Isometric (nothing is stored), then hands them to the flow. A
 * reload after a stale refusal remounts the flow so every choice starts from
 * the new read. Admin only: the card never mounts it for a Member.
 */
"use client";

import { useState } from "react";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Modal } from "@/components/ui/modal";
import { useApplyRemovalTemplateSetup, useRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { parseStep } from "@/lib/certification/removal-template-setup-copy";
import { RemovalTemplateSetupFlow } from "./setup-flow";

const TITLE_ID = "removal-template-setup-title";
const DIALOG_GUTTER_CLASS = "px-20";

export interface RemovalTemplateSetupDialogProps {
  isOpen: boolean;
  facilityId: string;
  /** The template a link or button starts with. */
  templateId?: string | null;
  /** The step a link or button starts on; any other value starts on Template. */
  step?: string | null;
  /** Make default starts on unless the caller says false, as the credit batch dialog does. */
  makeDefault?: boolean;
  onClose: () => void;
}

export function RemovalTemplateSetupDialog(props: RemovalTemplateSetupDialogProps) {
  // Owned here, above the Modal, so Escape and the close button can be held while Apply is saving.
  const apply = useApplyRemovalTemplateSetup();
  const pending = apply.isPending;
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={() => { if (!pending) props.onClose(); }}
      onOpen={() => { if (!pending) apply.reset(); }}
      dismissible={!pending}
      ariaLabelledBy={TITLE_ID}
      // Dense form: the Decisions step puts a 280px fill column beside each component name.
      width="lg"
      contentClassName=""
      // A stray backdrop click must not discard answers; the close button and Escape still work.
      dismissOnClickOutside={false}
    >
      <DialogBody {...props} apply={apply} />
    </Modal>
  );
}

function DialogBody({ facilityId, templateId = null, step = null, makeDefault = true, onClose, apply }: RemovalTemplateSetupDialogProps & { apply: ReturnType<typeof useApplyRemovalTemplateSetup> }) {
  const query = useRemovalTemplateSetup(facilityId, !!facilityId);
  const [reloads, setReloads] = useState(0);
  const reload = async () => {
    await query.refetch();
    setReloads((count) => count + 1);
  };

  return (
    <div className="flex flex-col">
      <div className={`${DIALOG_GUTTER_CLASS} flex flex-col gap-4 pb-16 pr-56 pt-20`}>
        <h2 id={TITLE_ID} className="title-heading-3">Set up Removal template</h2>
        {query.data && <p className="body-small text-[var(--color-text-secondary)]">{query.data.facility.name}</p>}
      </div>
      {query.isError ? (
        <div className={`${DIALOG_GUTTER_CLASS} flex flex-col gap-16 pb-20`}>
          <ServerError
            message="The Removal templates could not be read from Isometric."
            action={<Button size="small" busy={query.isFetching} onClick={() => void query.refetch()}>Try again</Button>}
          />
          <div><Button variant="default" onClick={onClose}>Cancel</Button></div>
        </div>
      ) : !query.data ? (
        <div className={`${DIALOG_GUTTER_CLASS} flex flex-col gap-16 pb-20`} aria-busy="true" aria-label="Loading Removal templates">
          <Skeleton className="h-160 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : (
        <RemovalTemplateSetupFlow
          key={`${facilityId}-${reloads}`}
          data={query.data}
          facilityId={facilityId}
          templateId={templateId}
          step={parseStep(step)}
          makeDefault={makeDefault}
          onReload={() => void reload()}
          apply={apply}
          onClose={onClose}
        />
      )}
    </div>
  );
}
