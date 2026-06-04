/**
 * Entity Select Types
 * Common types for the searchable entity selection component
 */

export interface EntityOption {
  id: string;
  code: string;
  name: string;
  /** Optional subtitle for additional context (e.g., location, type) */
  subtitle?: string;
}

export type EntityType =
  | "facility"
  | "reactor"
  | "supplier"
  | "customer"
  | "driver"
  | "operator"
  | "storageLocation"
  | "vehicle"
  | "feedstockType"
  | "feedstock"
  | "productionRun"
  | "application"
  | "formulation"
  | "biocharProduct"
  | "creditBatch";

export interface EntitySelectProps {
  /** The type of entity to select */
  entityType: EntityType;
  /** Current selected value (entity ID) */
  value?: string;
  /** Callback when selection changes */
  onChange: (value: string | undefined) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field has an error */
  error?: boolean;
  /** Optional className for styling */
  className?: string;
  /** Whether to allow creating new entities inline */
  allowCreate?: boolean;
  /** Label for the quick-add button */
  createLabel?: string;
  /** Callback when quick-add is triggered */
  onCreateNew?: () => void;
  /** Filter options (e.g., facilityId for filtering reactors by facility) */
  filterBy?: Record<string, string>;
  /** Auto-select when there is exactly one option available */
  autoSelectSingle?: boolean;
  /** Always show the search input while dropdown is open */
  alwaysShowSearch?: boolean;
  /** Hide the search input entirely */
  hideSearch?: boolean;
  /** Custom formatter for the selected value display */
  formatSelectedLabel?: (entity: EntityOption) => string;
}

export interface UseEntityOptionsParams {
  entityType: EntityType;
  search?: string;
  filterBy?: Record<string, string>;
  enabled?: boolean;
}

export interface QuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
  entityType: EntityType;
  filterBy?: Record<string, string>;
}
