"use client";

import { Trash, Pencil } from "@phosphor-icons/react/dist/ssr";
import type { Item } from "@/db/schema";
import { formatDistanceToNow, parseISO } from "date-fns";

interface ItemCardProps {
  item: Item;
  onEdit: (item: Item) => void;
  onArchive: (itemId: string) => void;
}

export function ItemCard({ item, onEdit, onArchive }: ItemCardProps) {
  return (
    <div className="border border-[var(--color-border-primary)] rounded-8 p-24 hover:border-[var(--clr-dark-purple)] transition-colors">
      <div className="flex items-start justify-between gap-24">
        <div className="flex-1 min-w-0">
          <h3 className="title-heading-4 mb-16">{item.title}</h3>
          {item.description && (
            <p className="body-small text-[var(--color-text-secondary)] mb-16">
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-16 text-xs text-[var(--color-text-tertiary)]">
            <span className="px-16 py-16 bg-[var(--color-bg-secondary)]rounded-4">
              {item.status}
            </span>
            <span>
              {formatDistanceToNow(parseISO(item.createdAt.toISOString()), {
                addSuffix: true,
              })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-16">
          <button
            onClick={() => onEdit(item)}
            className="p-16 rounded-4 hover:bg-[var(--color-bg-secondary)] transition-colors"
            aria-label="Edit item"
          >
            <Pencil size={20} />
          </button>
          <button
            onClick={() => onArchive(item.id)}
            className="p-16 rounded-4 hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-error)] transition-colors"
            aria-label="Archive item"
          >
            <Trash size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
