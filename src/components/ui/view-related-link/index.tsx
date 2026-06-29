/**
 * View Related Link Component
 *
 * A link component for navigating to related entities.
 * Shows entity type icon and count when available.
 */
"use client";

import Link from "next/link";
import {
  ArrowSquareOutIcon,
  FactoryIcon,
  TreeStructureIcon,
  WarehouseIcon,
  UsersIcon,
  TruckIcon,
  PackageIcon,
  FlaskIcon,
  ShoppingCartIcon,
  MapPinIcon,
  CertificateIcon,
  RecycleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

export type EntityType =
  | "facility"
  | "reactor"
  | "storage-location"
  | "supplier"
  | "customer"
  | "feedstock"
  | "production-run"
  | "sample"
  | "formulation"
  | "biochar-product"
  | "order"
  | "delivery"
  | "application"
  | "credit-batch";

interface ViewRelatedLinkProps {
  entityType: EntityType;
  entityId?: string;
  label?: string;
  count?: number;
  className?: string;
  size?: "sm" | "md";
}

// ============================================
// Entity Config
// ============================================

const entityConfig: Record<
  EntityType,
  { icon: typeof FactoryIcon; path: string; label: string }
> = {
  facility: { icon: FactoryIcon, path: "/facilities", label: "Facility" },
  reactor: { icon: TreeStructureIcon, path: "/reactors", label: "Reactor" },
  "storage-location": {
    icon: WarehouseIcon,
    path: "/storage-locations",
    label: "Storage Location",
  },
  supplier: { icon: UsersIcon, path: "/suppliers", label: "Supplier" },
  customer: { icon: UsersIcon, path: "/customers", label: "Customer" },
  feedstock: { icon: RecycleIcon, path: "/feedstocks", label: "Feedstock" },
  "production-run": {
    icon: FactoryIcon,
    path: "/production-runs",
    label: "Production Run",
  },
  sample: { icon: FlaskIcon, path: "/samples", label: "Sample" },
  formulation: { icon: FlaskIcon, path: "/formulations", label: "Formulation" },
  "biochar-product": {
    icon: PackageIcon,
    path: "/biochar-products",
    label: "Biochar Product",
  },
  order: { icon: ShoppingCartIcon, path: "/orders", label: "Order" },
  delivery: { icon: TruckIcon, path: "/deliveries", label: "Delivery" },
  application: { icon: MapPinIcon, path: "/applications", label: "Application" },
  "credit-batch": {
    icon: CertificateIcon,
    path: "/credit-batches",
    label: "Credit Batch",
  },
};

// ============================================
// Component
// ============================================

export function ViewRelatedLink({
  entityType,
  entityId,
  label,
  count,
  className,
  size = "sm",
}: ViewRelatedLinkProps) {
  const config = entityConfig[entityType];
  const Icon = config.icon;

  // Build the href - if entityId is provided, link to detail page
  const href = entityId ? `${config.path}/${entityId}` : config.path;

  const displayLabel = label || config.label;

  const sizeClasses = {
    sm: "body-caption px-[8px] py-[4px] gap-[4px]",
    md: "text-[14px] px-[12px] py-[6px] gap-[6px]",
  };

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center rounded-4 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-medium)] hover:text-[var(--color-text-primary)] transition-colors",
        sizeClasses[size],
        className
      )}
    >
      <Icon size={size === "sm" ? 14 : 16} weight="regular" />
      <span>{displayLabel}</span>
      {typeof count === "number" && (
        <span className="px-[4px] py-[1px] bg-[var(--color-background-medium)] rounded-4 text-[10px] font-medium">
          {count}
        </span>
      )}
      <ArrowSquareOutIcon size={size === "sm" ? 12 : 14} weight="regular" className="opacity-60" />
    </Link>
  );
}

// ============================================
// View Related Group
// ============================================

interface ViewRelatedGroupProps {
  children: React.ReactNode;
  label?: string;
  className?: string;
}

export function ViewRelatedGroup({
  children,
  label = "View Related",
  className,
}: ViewRelatedGroupProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-[8px]", className)}>
      <span className="body-caption text-[var(--color-text-tertiary)]">{label}:</span>
      {children}
    </div>
  );
}

// ============================================
// Convenience Components for Common Patterns
// ============================================

interface EntityLinkProps {
  id?: string;
  label?: string;
  count?: number;
  className?: string;
  size?: "sm" | "md";
}

export function FacilityLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="facility" entityId={props.id} {...props} />;
}

export function ReactorLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="reactor" entityId={props.id} {...props} />;
}

export function SupplierLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="supplier" entityId={props.id} {...props} />;
}

export function CustomerLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="customer" entityId={props.id} {...props} />;
}

export function ProductionRunLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="production-run" entityId={props.id} {...props} />;
}

export function ApplicationLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="application" entityId={props.id} {...props} />;
}

export function DeliveryLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="delivery" entityId={props.id} {...props} />;
}

export function CreditBatchLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="credit-batch" entityId={props.id} {...props} />;
}

export function BiocharProductLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="biochar-product" entityId={props.id} {...props} />;
}

export function OrderLink(props: EntityLinkProps) {
  return <ViewRelatedLink entityType="order" entityId={props.id} {...props} />;
}
