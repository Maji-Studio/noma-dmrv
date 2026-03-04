"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { ItemCard } from "./item-card";
import { ItemForm } from "./item-form";
import type { Item } from "@/db/schema";
import {
  useProjectItems,
  useCreateItem,
  useUpdateItem,
  useArchiveItem,
} from "@/hooks/use-items";

interface ItemListProps {
  projectId: string;
}

export function ItemList({ projectId }: ItemListProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  const { data: items, isLoading } = useProjectItems(projectId);
  const createItem = useCreateItem(projectId);
  const updateItem = useUpdateItem(projectId);
  const archiveItem = useArchiveItem(projectId);

  const handleCreate = async (data: { title: string; description?: string }) => {
    const result = await createItem.mutateAsync(data);
    if (result.success) {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (data: { title: string; description?: string }) => {
    if (!editingItem) return;

    const result = await updateItem.mutateAsync({
      itemId: editingItem.id,
      ...data,
    });
    if (result.success) {
      setEditingItem(null);
    }
  };

  const handleArchive = async (itemId: string) => {
    if (confirm("Are you sure you want to archive this item?")) {
      await archiveItem.mutateAsync(itemId);
    }
  };

  if (isLoading) {
    return <div className="body-large">Loading items...</div>;
  }

  const activeItems = items?.filter((item) => item.status === "active") ?? [];

  return (
    <div className="space-y-32">
      <div className="flex items-center justify-between">
        <h1 className="title-heading-1">Items</h1>
        {!isCreating && !editingItem && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-16 h-[48px] px-16 bg-[var(--clr-dark-purple)] text-white rounded-none hover:opacity-90 transition-opacity"
          >
            <Plus size={20} weight="bold" />
            New Item
          </button>
        )}
      </div>

      {isCreating && (
        <div className="border border-[var(--color-border-primary)] rounded-8 p-32">
          <h2 className="title-heading-3 mb-24">Create New Item</h2>
          <ItemForm
            onSubmit={handleCreate}
            onCancel={() => setIsCreating(false)}
            isSubmitting={createItem.isPending}
          />
        </div>
      )}

      {editingItem && (
        <div className="border border-[var(--color-border-primary)] rounded-8 p-32">
          <h2 className="title-heading-3 mb-24">Edit Item</h2>
          <ItemForm
            item={editingItem}
            onSubmit={handleUpdate}
            onCancel={() => setEditingItem(null)}
            isSubmitting={updateItem.isPending}
          />
        </div>
      )}

      <div className="space-y-24">
        {activeItems.length === 0 ? (
          <div className="text-center py-48 border border-dashed border-[var(--color-border-primary)] rounded-8">
            <p className="body-large text-[var(--color-text-secondary)]">
              No items yet. Create your first item to get started.
            </p>
          </div>
        ) : (
          activeItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onEdit={setEditingItem}
              onArchive={handleArchive}
            />
          ))
        )}
      </div>
    </div>
  );
}
