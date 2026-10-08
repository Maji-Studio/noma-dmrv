"use client";

import { Modal } from "@/components/ui";
import { useUpdateApiKey, type ApiKeyListItem } from "@/hooks/use-api-keys";
import { EditApiKeyForm } from "./api-key-form";

export function EditApiKeyDialog({ apiKey, onClose, organizationId }: {
  apiKey: ApiKeyListItem | null;
  onClose: () => void;
  organizationId: string;
}) {
  const update = useUpdateApiKey(organizationId);
  const close = () => { if (!update.isPending) onClose(); };
  return (
    <Modal isOpen={!!apiKey} onClose={close} ariaLabelledBy="edit-api-key-title" width="lg" dismissible={!update.isPending} dismissOnClickOutside={false}>
      <div className="flex flex-col gap-20">
        <h2 id="edit-api-key-title" className="title-heading-3 pr-32">Edit API key</h2>
        {apiKey && <EditApiKeyForm key={apiKey.id} apiKey={apiKey} isPending={update.isPending} onCancel={close} onSubmit={async (values) => { await update.mutateAsync(values); onClose(); }} />}
      </div>
    </Modal>
  );
}
