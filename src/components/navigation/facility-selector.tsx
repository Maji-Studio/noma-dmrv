/**
 * FacilitySelector
 * Dark-themed facility selector for the sidebar.
 * Shows a custom dropdown menu with facility options and management actions.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Warehouse, CaretDown, Plus, Check, GearSix } from "@phosphor-icons/react";
import { useFacilityContext } from "@/hooks/use-facility-context";

export function FacilitySelector() {
  const router = useRouter();
  const { facilityId, setFacilityId, facilities, selectedFacility, isLoading } =
    useFacilityContext();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedFacilityName = selectedFacility?.name ?? "Select facility";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="mx-8 px-10 py-10">
        <div className="h-36 bg-[var(--color-white-100)]/[0.06] animate-pulse" />
      </div>
    );
  }

  // Empty state — no facilities yet
  if (facilities.length === 0) {
    return (
      <div className="mx-8 px-10 py-10">
        <Link
          href="/facilities"
          className="flex items-center gap-8 h-36 px-10 border border-dashed border-[var(--color-white-25)] text-[var(--color-white-50)] hover:text-white hover:border-[var(--clr-purple)] transition-colors duration-150"
        >
          <Plus size={14} weight="bold" />
          <span className="body-caption">Add First Facility</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-8 px-10 py-10" ref={containerRef}>
      <div className="relative">
        <Warehouse
          size={16}
          weight="fill"
          className="absolute left-10 top-1/2 -translate-y-1/2 text-white pointer-events-none z-10"
        />
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          className="w-full h-36 pl-32 pr-28 bg-[var(--color-white-100)]/[0.06] border border-[var(--color-white-10)] text-white body-caption cursor-pointer text-left hover:bg-[var(--color-white-100)]/[0.10] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clr-purple)] transition-colors duration-150"
        >
          <span className="block truncate">{selectedFacilityName}</span>
        </button>
        <CaretDown
          size={14}
          weight="bold"
          className={`absolute right-10 top-1/2 -translate-y-1/2 text-[var(--color-white-50)] pointer-events-none transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        />

        {isOpen && (
          <div className="absolute z-50 mt-6 w-full border border-[var(--color-white-10)] bg-[var(--clr-dark-purple)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
            <ul role="listbox" id={listboxId} aria-label="Select facility" className="max-h-[240px] overflow-y-auto py-4">
              {facilities.map((facility) => {
                const isSelected = facility.id === facilityId;
                return (
                  <li key={facility.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setFacilityId(facility.id);
                        setIsOpen(false);
                      }}
                      className={`w-full h-40 px-10 flex items-center justify-between gap-8 body-caption text-left transition-colors duration-150 ${
                        isSelected
                          ? "text-white bg-[var(--color-white-100)]/[0.08]"
                          : "text-[var(--color-white-75)] hover:text-white hover:bg-[var(--color-white-100)]/[0.06]"
                      }`}
                    >
                      <span className="truncate">{facility.name}</span>
                      {isSelected && (
                        <Check
                          size={12}
                          weight="bold"
                          className="text-[var(--clr-purple)] shrink-0"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-[var(--color-white-10)] p-4">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  router.push("/facilities");
                }}
                className="w-full h-40 px-10 flex items-center gap-8 body-caption text-[var(--color-white-75)] hover:text-white hover:bg-[var(--color-white-100)]/[0.06] transition-colors duration-150"
              >
                <GearSix size={14} weight="bold" className="shrink-0" />
                <span>Manage Facilities</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
