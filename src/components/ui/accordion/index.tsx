/**
 * Accordion Component
 * Built on Base UI Accordion for collapsible form sections
 */
"use client";

import * as React from "react";
import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// ============================================
// Root
// ============================================

interface AccordionRootProps {
  children: React.ReactNode;
  /** Allow multiple panels to be open simultaneously */
  multiple?: boolean;
  /** Default expanded panels (array of values) */
  defaultValue?: string[];
  /** Controlled expanded panels */
  value?: string[];
  /** Callback when expanded panels change */
  onValueChange?: (value: string[]) => void;
  className?: string;
}

function Root({
  children,
  multiple = true,
  defaultValue,
  value,
  onValueChange,
  className,
}: AccordionRootProps) {
  return (
    <BaseAccordion.Root
      multiple={multiple}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      className={cn("flex flex-col gap-24", className)}
    >
      {children}
    </BaseAccordion.Root>
  );
}

// ============================================
// Item
// ============================================

interface AccordionItemProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

function Item({ children, value, className }: AccordionItemProps) {
  return (
    <BaseAccordion.Item
      value={value}
      className={cn(
        "border border-[var(--color-border-tertiary)] rounded-[8px] bg-[var(--color-background-white)] overflow-hidden",
        className
      )}
    >
      {children}
    </BaseAccordion.Item>
  );
}

// ============================================
// Header
// ============================================

interface AccordionHeaderProps {
  children: React.ReactNode;
  className?: string;
}

function Header({ children, className }: AccordionHeaderProps) {
  return (
    <BaseAccordion.Header className={cn("m-0", className)}>
      {children}
    </BaseAccordion.Header>
  );
}

// ============================================
// Trigger
// ============================================

interface AccordionTriggerProps {
  children: React.ReactNode;
  className?: string;
}

function Trigger({ children, className }: AccordionTriggerProps) {
  return (
    <BaseAccordion.Trigger
      className={cn(
        "group flex w-full items-center justify-between gap-24 px-24 py-16",
        "bg-[var(--color-background-light)] hover:bg-[var(--color-surface-medium)]",
        "text-left transition-colors cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-inset",
        className
      )}
    >
      <span className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
        {children}
      </span>
      <CaretDown
        size={20}
        weight="bold"
        className="text-[var(--color-text-tertiary)] transition-transform duration-200 group-data-[panel-open]:rotate-180"
      />
    </BaseAccordion.Trigger>
  );
}

// ============================================
// Panel
// ============================================

interface AccordionPanelProps {
  children: React.ReactNode;
  className?: string;
}

function Panel({ children, className }: AccordionPanelProps) {
  return (
    <BaseAccordion.Panel
      className={cn(
        "overflow-hidden",
        "data-[starting-style]:h-0",
        "data-[ending-style]:h-0",
        "transition-[height] duration-200 ease-out",
        className
      )}
    >
      <div className="p-24 border-t border-[var(--color-border-tertiary)]">
        {children}
      </div>
    </BaseAccordion.Panel>
  );
}

// ============================================
// Exports
// ============================================

export const Accordion = {
  Root,
  Item,
  Header,
  Trigger,
  Panel,
};

export type {
  AccordionRootProps,
  AccordionItemProps,
  AccordionHeaderProps,
  AccordionTriggerProps,
  AccordionPanelProps,
};
