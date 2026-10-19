import { ArrowSquareOutIcon, EyeIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Combobox } from "@base-ui/react/combobox";
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
  value?: string;
  highlightActions: boolean;
  noneOption: EntitySelectProps["noneOption"];
  editLabel: string;
  /** The edit row only opens a read-only view (archived selection): show the view icon. */
  isViewOnly?: boolean;
  createLabel: string;
  /** The create row opens a page in a new tab (`createHref`), not a quick-add dialog. */
  createOpensNewTab?: boolean;
}

export function EntitySelectRow({
  row, value, noneOption, editLabel, isViewOnly, createLabel, createOpensNewTab, highlightActions,
}: EntitySelectRowProps) {
  const isAction = row.kind === "edit" || row.kind === "create";
  const disabled = row.kind === "option" && row.option.disabled;
  const selected = row.kind === "none" ? !value : row.kind === "option" && row.option.id === value;
  const className = cn(
    "min-h-44 px-12 py-8 transition-colors",
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
    isAction && "flex items-center gap-8 text-[var(--color-interaction)]",
    // The selected tint outranks the highlight, as it did before Combobox.
    (!isAction || highlightActions) && !selected && "data-[highlighted]:bg-[var(--color-background-medium)]",
    selected && "bg-[var(--color-background-interaction-light)]",
  );
  // Disabled rows stay visible but do not join Combobox's navigation registry.
  if (disabled && row.kind === "option") return (
    <li role="option" aria-disabled="true" aria-selected={selected} data-testid={`entity-option-${row.option.id}`} className={className}>
      <EntityOptionText option={row.option} />
    </li>
  );
  return (
    <Combobox.Item
      data-entity-select-item=""
      render={<li />}
      value={row}
      role={isAction ? "button" : "option"}
      aria-selected={isAction ? undefined : selected}
      data-testid={row.kind === "option" ? `entity-option-${row.option.id}` : `entity-select-${row.kind}`}
      className={className}
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
            ? (isViewOnly
              ? <EyeIcon aria-hidden weight="bold" className="size-16" />
              : <PencilSimpleIcon aria-hidden weight="bold" className="size-16" />)
            : createOpensNewTab
              ? <ArrowSquareOutIcon aria-hidden weight="bold" className="size-16" />
              : <PlusIcon aria-hidden weight="bold" className="size-16" />}
          <span className="text-[var(--text-s)]">
            {row.kind === "edit" ? editLabel : createLabel}
            {row.kind === "create" && createOpensNewTab && (
              <span className="sr-only"> (opens in a new tab)</span>
            )}
          </span>
        </>
      )}
    </Combobox.Item>
  );
}
