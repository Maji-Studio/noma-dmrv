/**
 * Slide-Over Panel Component
 *
 * A reusable slide-over panel built with Base UI Dialog for entity creation
 * and editing forms. Dark header, light body, pinned footer.
 */
"use client";

import * as React from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Root
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelRootProps {
  children: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Default open state for uncontrolled usage */
  defaultOpen?: boolean;
  /** Whether clicking outside dismisses the panel (default: true) */
  dismissOnClickOutside?: boolean;
  /** Modal mode controls focus trapping and scroll locking */
  modal?: boolean | "trap-focus";
}

function Root({
  children,
  open,
  onOpenChange,
  defaultOpen = false,
  dismissOnClickOutside = true,
  modal = true,
}: SlideOverPanelRootProps) {
  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      onOpenChange?.(newOpen);
    },
    [onOpenChange]
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={handleOpenChange}
      defaultOpen={defaultOpen}
      disablePointerDismissal={!dismissOnClickOutside}
      modal={modal}
    >
      {children}
    </Dialog.Root>
  );
}
Root.displayName = "SlideOverPanel.Root";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Trigger
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelTriggerProps {
  children: React.ReactNode;
  className?: string;
}

const Trigger = React.forwardRef<HTMLButtonElement, SlideOverPanelTriggerProps>(
  ({ children, className }, ref) => {
    return (
      <Dialog.Trigger
        ref={ref}
        className={className}
        render={(props) => {
          if (React.isValidElement(children)) {
            const childProps = children.props as Record<string, unknown>;
            const existingOnClick = childProps.onClick as
              | ((e: React.MouseEvent) => void)
              | undefined;
            const triggerOnClick = props.onClick as
              | ((e: React.MouseEvent) => void)
              | undefined;
            return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
              ...props,
              className: cn(
                (childProps as { className?: string }).className,
                className
              ),
              onClick: (e: React.MouseEvent) => {
                existingOnClick?.(e);
                triggerOnClick?.(e);
              },
            });
          }
          return <button {...props}>{children}</button>;
        }}
      />
    );
  }
);
Trigger.displayName = "SlideOverPanel.Trigger";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Content
 * -----------------------------------------------------------------------------------------------*/

const slideOverContentVariants = cva(
  [
    "fixed top-0 right-0 z-50 h-full",
    "flex flex-col",
    // Elevated surface: pure paper (the page field is the warm tint; sheets,
    // menus and dialogs reserve white) + full-ink hairline — no shadow, the
    // scrim + border do the elevation (Maji DS).
    "bg-[var(--paper)] [border-left:var(--hair)]",
    // Animation
    "transition-transform duration-300 ease-out",
    "data-[open]:translate-x-0",
    "data-[starting-style]:translate-x-full",
    "data-[ending-style]:translate-x-full",
    "outline-none",
  ],
  {
    variants: {
      size: {
        default: "w-full sm:w-[600px]",
        narrow: "w-full sm:w-[360px]",
        wide: "w-full sm:w-[640px]",
        full: "w-full sm:w-full sm:max-w-[calc(100%-64px)]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

interface SlideOverPanelContentProps
  extends VariantProps<typeof slideOverContentVariants> {
  children: React.ReactNode;
  className?: string;
}

function Content({
  children,
  size,
  className,
}: SlideOverPanelContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop
        className={cn(
          "fixed inset-0 z-40 bg-[var(--color-black-50)]",
          "transition-opacity duration-300",
          "data-[open]:opacity-100",
          "data-[starting-style]:opacity-0",
          "data-[ending-style]:opacity-0"
        )}
      />
      <Dialog.Popup
        className={cn(slideOverContentVariants({ size }), className)}
      >
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}
Content.displayName = "SlideOverPanel.Content";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Header — dark branded header
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelHeaderProps {
  children: React.ReactNode;
  className?: string;
  showClose?: boolean;
}

function Header({
  children,
  className,
  showClose = true,
}: SlideOverPanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-16",
        "px-24 py-16",
        "border-b border-[var(--color-border-secondary)]",
        "bg-[var(--color-background-white)]",
        "shrink-0",
        className
      )}
    >
      <div className="flex flex-col gap-4 min-w-0">
        {children}
      </div>
      {showClose && (
        <Dialog.Close
          aria-label="Close panel"
          render={
            <Button
              variant="noOutline"
              size="icon"
              className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            />
          }
        >
          <CloseIcon />
        </Dialog.Close>
      )}
    </div>
  );
}
Header.displayName = "SlideOverPanel.Header";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Title — white text for dark header
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelTitleProps {
  children: React.ReactNode;
  className?: string;
}

const Title = React.forwardRef<HTMLHeadingElement, SlideOverPanelTitleProps>(
  ({ children, className }, ref) => {
    return (
      <Dialog.Title
        ref={ref}
        className={cn(
          "title-heading-4 text-[var(--color-text-primary)]",
          "truncate",
          className
        )}
      >
        {children}
      </Dialog.Title>
    );
  }
);
Title.displayName = "SlideOverPanel.Title";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Description
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

const Description = React.forwardRef<
  HTMLParagraphElement,
  SlideOverPanelDescriptionProps
>(({ children, className }, ref) => {
  return (
    <Dialog.Description
      ref={ref}
      className={cn(
        "body-small text-[var(--color-text-tertiary)]",
        className
      )}
    >
      {children}
    </Dialog.Description>
  );
});
Description.displayName = "SlideOverPanel.Description";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Body — scrollable form area
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelBodyProps {
  children: React.ReactNode;
  className?: string;
  /** Remove bottom padding so sticky/flush footers inside have no gap */
  noPaddingBottom?: boolean;
  /**
   * Stretch the single child (a form root) to fill the body height so its
   * `mt-auto` CTA row is pinned to the bottom even when the form is short.
   * The child still grows past the viewport on long forms — the body scrolls
   * and the sticky footer keeps the CTA in view. Used by edit/create forms.
   */
  fillHeight?: boolean;
}

function Body({
  children,
  className,
  noPaddingBottom,
  fillHeight,
}: SlideOverPanelBodyProps) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto",
        noPaddingBottom ? "p-24 pb-0" : "p-24",
        // Form-root child fills the body as a flex column so FormActions'
        // `mt-auto` can pin the CTA row to the bottom on short forms.
        fillHeight && "flex flex-col [&>*]:flex [&>*]:flex-1 [&>*]:flex-col",
        className
      )}
    >
      {children}
    </div>
  );
}
Body.displayName = "SlideOverPanel.Body";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Footer
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelFooterProps {
  children: React.ReactNode;
  className?: string;
}

function Footer({ children, className }: SlideOverPanelFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-12",
        "px-24 py-16",
        "border-t border-[var(--color-border-secondary)]",
        "bg-[var(--color-background-white)]",
        "shrink-0",
        className
      )}
    >
      {children}
    </div>
  );
}
Footer.displayName = "SlideOverPanel.Footer";

/* -------------------------------------------------------------------------------------------------
 * SlideOverPanel.Close
 * -----------------------------------------------------------------------------------------------*/

interface SlideOverPanelCloseProps {
  children: React.ReactNode;
  className?: string;
}

const Close = React.forwardRef<HTMLButtonElement, SlideOverPanelCloseProps>(
  ({ children, className }, ref) => {
    return (
      <Dialog.Close
        ref={ref}
        className={className}
        render={(props) => {
          if (React.isValidElement(children)) {
            const childProps = children.props as Record<string, unknown>;
            const existingOnClick = childProps.onClick as
              | ((e: React.MouseEvent) => void)
              | undefined;
            const closeOnClick = props.onClick as
              | ((e: React.MouseEvent) => void)
              | undefined;
            return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
              ...props,
              className: cn(
                (childProps as { className?: string }).className,
                className
              ),
              onClick: (e: React.MouseEvent) => {
                existingOnClick?.(e);
                closeOnClick?.(e);
              },
            });
          }
          return <button {...props}>{children}</button>;
        }}
      />
    );
  }
);
Close.displayName = "SlideOverPanel.Close";

/* -------------------------------------------------------------------------------------------------
 * Icons
 * -----------------------------------------------------------------------------------------------*/

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------------------------*/

export const SlideOverPanel = {
  Root,
  Trigger,
  Content,
  Header,
  Title,
  Description,
  Body,
  Footer,
  Close,
};

export {
  Root as SlideOverPanelRoot,
  Trigger as SlideOverPanelTrigger,
  Content as SlideOverPanelContent,
  Header as SlideOverPanelHeader,
  Title as SlideOverPanelTitle,
  Description as SlideOverPanelDescription,
  Body as SlideOverPanelBody,
  Footer as SlideOverPanelFooter,
  Close as SlideOverPanelClose,
};
