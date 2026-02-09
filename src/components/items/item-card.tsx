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
    <div className="border border-[var(--color-border-primary)] rounded-lg p-m hover:border-[var(--clr-dark-purple)] transition-colors">
      <div className="flex items-start justify-between gap-m">
        <div className="flex-1 min-w-0">
          <h3 className="title-heading-4 mb-xs">{item.title}</h3>
          {item.description && (
            <p className="body-small text-[var(--color-text-secondary)] mb-s">
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-s text-xs text-[var(--color-text-tertiary)]">
            <span className="px-s py-xs bg-[var(--color-bg-secondary)] rounded">
              {item.status}
            </span>
            <span>
              {formatDistanceToNow(parseISO(item.createdAt.toISOString()), {
                addSuffix: true,
              })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-xs">
          <button
            onClick={() => onEdit(item)}
            className="p-xs rounded hover:bg-[var(--color-bg-secondary)] transition-colors"
            aria-label="Edit item"
          >
            <Pencil size={20} />
          </button>
          <button
            onClick={() => onArchive(item.id)}
            className="p-xs rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-error)] transition-colors"
            aria-label="Archive item"
          >
            <Trash size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
