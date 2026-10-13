import { PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import type { EntityOption, EntitySelectProps } from "./types";

export type SelectRow =
  | { id: string; kind: "none" | "edit" | "create" }
  | { id: string; kind: "option"; option: EntityOption };

export function EntityOptionText({ option }: { option: EntityOption }) {
  return (
    <>
      <span className="block truncate text-[var(--text-s)] text-[var(--color-text-primary)]">
        {option.name}
      </span>
      {option.subtitle && (
        <span className="block body-small text-[var(--color-text-secondary)] mt-2">
          {option.subtitle}
        </span>
      )}
    </>
  );
}

interface EntitySelectRowProps {
  row: SelectRow;
  active: boolean;
  value?: string;
  noneOption: EntitySelectProps["noneOption"];
  editLabel: string;
  createLabel: string;
  onActivate: () => void;
  onHighlight: () => void;
}

export function EntitySelectRow({
  row, active, value, noneOption, editLabel, createLabel, onActivate, onHighlight,
}: EntitySelectRowProps) {
  const isAction = row.kind === "edit" || row.kind === "create";
  const disabled = row.kind === "option" && row.option.disabled;
  const selected = row.kind === "none" ? !value : row.kind === "option" && row.option.id === value;
  return (
    <li
      id={row.id}
      // The portal mounts after the owner's effects. A row ref also scrolls
      // the initial highlight, including when a hint precedes it in the DOM.
      ref={(element) => {
        if (element && active) document.getElementById(row.id)?.scrollIntoView({ block: "nearest" });
      }}
      role={isAction ? "button" : "option"}
      aria-selected={isAction ? undefined : selected}
      aria-disabled={disabled || undefined}
      data-testid={row.kind === "option" ? `entity-option-${row.option.id}` : `entity-select-${row.kind}`}
      onClick={disabled ? undefined : onActivate}
      onPointerMove={disabled ? undefined : onHighlight}
      className={cn(
        "min-h-44 px-12 py-8 transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        isAction && "flex items-center gap-8 text-[var(--color-interaction)]",
        active && "bg-[var(--color-background-medium)]",
        selected && "bg-[var(--color-background-interaction-light)]",
      )}
    >
      {row.kind === "option" ? <EntityOptionText option={row.option} /> : row.kind === "none" ? (
        <>
          <span className="block text-[var(--text-s)]">{noneOption?.label}</span>
          {noneOption?.subtitle && (
            <span className="block body-small text-[var(--color-text-secondary)] mt-2">
              {noneOption.subtitle}
            </span>
          )}
        </>
      ) : (
        <>
          {row.kind === "edit"
            ? <PencilSimpleIcon aria-hidden weight="bold" className="size-16" />
            : <PlusIcon aria-hidden weight="bold" className="size-16" />}
          <span className="text-[var(--text-s)]">
            {row.kind === "edit" ? editLabel : createLabel}
          </span>
        </>
      )}
    </li>
  );
}
