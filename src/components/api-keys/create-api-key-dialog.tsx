"use client";

import { useState } from "react";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { Button, Modal, Notice } from "@/components/ui";
import { useCreateApiKey } from "@/hooks/use-api-keys";
import { CreateApiKeyForm } from "./api-key-form";

export function CreateApiKeyDialog({ isOpen, onClose, organizationId }: {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}) {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const create = useCreateApiKey(organizationId, (result) => setPlaintext(result.key));

  function close() {
    if (create.isPending) return;
    // Clear synchronously even while the dialog's closing animation runs.
    setPlaintext(null);
    setCopyState("idle");
    create.reset();
    onClose();
  }

  async function copy() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopyState("copied");
    } catch { setCopyState("failed"); }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} ariaLabelledBy="create-api-key-title" width="lg" dismissOnClickOutside={false} dismissible={!create.isPending}>
      <div className="flex flex-col gap-20">
        <h2 id="create-api-key-title" className="title-heading-3 pr-32">{plaintext ? "API key created" : "Create API key"}</h2>
        {plaintext ? (
          <>
            <Notice tone="warning">Copy this key and store it securely. It will not be shown again after you close this dialog.</Notice>
            <FormField id="api-key-plaintext" label="API key">
              <FormInput id="api-key-plaintext" readOnly value={plaintext} autoComplete="off" spellCheck={false} className="font-mono" />
            </FormField>
            <ServerError message={copyState === "failed" ? "The key was not copied. Select the key and copy it manually." : undefined} />
            {copyState === "copied" && <Notice tone="success">API key copied.</Notice>}
            <div className="flex flex-wrap gap-12">
              <Button variant="primary" onClick={copy}>Copy key</Button>
              <Button onClick={close}>Done</Button>
            </div>
          </>
        ) : <CreateApiKeyForm onSubmit={create.mutateAsync} onCancel={close} isPending={create.isPending} />}
      </div>
    </Modal>
  );
}
