/**
 * MobileNav — the `< md` chrome: a sticky top bar with the brand on the left
 * and a hamburger on the right that opens the full nav as a right-anchored
 * drawer. Hidden at `md`+ where the desktop `<aside>` takes over.
 *
 * The drawer is built on the same Base UI `Dialog` primitive as
 * `SlideOverPanel`/`Modal`, so it inherits the focus trap, scroll lock, ESC
 * dismissal, and backdrop click for free. It renders the shared
 * `SidebarContent`, so the mobile nav is always identical to the desktop rail.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { List, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-media-query";
import { SidebarContent } from "./sidebar-content";

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  const isMobile = useIsMobile();

  // The drawer (and its focus trap + scroll lock) only belongs below `md`. If
  // the viewport grows to desktop while it's open — rotate, resize — the popup
  // and backdrop hide via `md:hidden` but the modal's trap/lock would otherwise
  // linger over an invisible UI. Close it the moment we leave the mobile range.
  // Render-time correction (same approach as the route backstop below) so the
  // close lands before commit, no effect.
  if (!isMobile && isOpen) setIsOpen(false);

  // Close the drawer whenever the route changes. Most link taps already close
  // it via SidebarContent's `onNavigate`; this is the backstop for navigation
  // that doesn't (e.g. programmatic redirects). Adjusting state during render
  // on a changed value is React's recommended alternative to a route-watching
  // effect — no cascading renders, and the close happens before commit.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (isOpen) setIsOpen(false);
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen} modal>
      {/* Sticky top bar — mobile only */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between h-56 px-16 border-b border-[var(--color-white-10)] bg-[#0c0114]">
        <Link href="/dashboard" className="flex items-center gap-10 min-w-0">
          <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[12px] leading-none">
              D
            </span>
          </div>
          <span className="body-small font-medium text-white truncate">
            Dark Earth Carbon
          </span>
        </Link>

        <Dialog.Trigger
          className="flex items-center justify-center size-44 -mr-10 text-[var(--color-white-75)] hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clr-purple)]"
          aria-label="Open navigation menu"
        >
          <List size={22} weight="bold" />
        </Dialog.Trigger>
      </header>

      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "md:hidden fixed inset-0 z-40 bg-[var(--color-black-50)]",
            "transition-opacity duration-300",
            "data-[open]:opacity-100",
            "data-[starting-style]:opacity-0",
            "data-[ending-style]:opacity-0",
          )}
        />
        <Dialog.Popup
          aria-label="Navigation menu"
          className={cn(
            "md:hidden fixed top-0 right-0 z-50 h-full w-[280px] max-w-[85vw]",
            "shadow-[-8px_0_32px_rgba(0,0,0,0.4)] outline-none",
            "transition-transform duration-300 ease-out",
            "data-[open]:translate-x-0",
            "data-[starting-style]:translate-x-full",
            "data-[ending-style]:translate-x-full",
          )}
        >
          {/* Close button — overlays the brand header inside SidebarContent */}
          <Dialog.Close
            aria-label="Close navigation menu"
            className="absolute top-6 right-6 z-10 flex items-center justify-center size-44 text-[var(--color-white-50)] hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clr-purple)]"
          >
            <X size={20} weight="bold" />
          </Dialog.Close>
          <SidebarContent onNavigate={() => setIsOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
