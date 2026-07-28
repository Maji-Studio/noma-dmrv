"use client";

import { useState } from "react";
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, ServerError } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useImportIsometricFeedstockType } from "@/hooks/use-feedstock-types";
import type { IsometricFeedstockType } from "@/lib/isometric";
import {
  PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS,
  pyrolysisFeedstockCategories,
} from "@/schemas/feedstock-types";
import { IsometricFeedstockBrowser } from "./isometric-feedstock-browser";

const TITLE_ID = "isometric-feedstock-import-title";
type PyrolysisFeedstockCategory = (typeof pyrolysisFeedstockCategories)[number];

interface IsometricFeedstockImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function IsometricFeedstockImportDialog({
  open,
  onClose,
}: IsometricFeedstockImportDialogProps) {
  const [selected, setSelected] = useState<IsometricFeedstockType | null>(null);
  const [category, setCategory] = useState<PyrolysisFeedstockCategory | "">("");
  const [error, setError] = useState<string | null>(null);
  const importFeedstockType = useImportIsometricFeedstockType();
  const toast = useToast();

  const close = () => {
    setSelected(null);
    setCategory("");
    setError(null);
    onClose();
  };

  const handleImport = async () => {
    if (!selected || !category) return;
    setError(null);
    try {
      await importFeedstockType.mutateAsync({
        isometricFeedstockTypeId: selected.id,
        category,
      });
      toast.success("Feedstock type imported from Isometric");
      close();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "The feedstock type was not imported. Check the category and try again.",
      );
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      ariaLabelledBy={TITLE_ID}
      width="lg"
      dismissOnClickOutside={false}
    >
      <div className="flex flex-col gap-20">
        <div className="flex flex-col gap-6 pr-40">
          <div className="flex items-center gap-8">
            <SealCheckIcon size={20} weight="bold" aria-hidden />
            <h2 id={TITLE_ID} className="title-heading-3">
              Import from Isometric
            </h2>
          </div>
          <p className="body-small text-[var(--color-text-secondary)]">
            Choose a registry catalogue entry, then assign its local category.
          </p>
        </div>

        <IsometricFeedstockBrowser
          onSelect={(entry) => {
            setSelected(entry);
            setError(null);
          }}
          selectedId={selected?.id ?? null}
        />

        {selected && (
          <div className="border-t border-[var(--color-border-tertiary)] pt-16">
            <FormField id="import-feedstock-category" label="Local category" required>
              <FormSelect
                id="import-feedstock-category"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as PyrolysisFeedstockCategory | "")
                }
                options={PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS}
                placeholder="Select category..."
                disabled={importFeedstockType.isPending}
              />
            </FormField>
          </div>
        )}

        {error && <ServerError message={error} />}

        <div className="flex justify-end gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
          <Button variant="default" onClick={close} disabled={importFeedstockType.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={!selected || !category}
            busy={importFeedstockType.isPending}
          >
            Import feedstock type
          </Button>
        </div>
      </div>
    </Modal>
  );
}
