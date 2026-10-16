/** One Phosphor icon per record type, matching the sidebar and entity pages where they have one. */
import { createElement, type ReactElement } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  CertificateIcon,
  CubeIcon,
  FactoryIcon,
  FileIcon,
  FileTextIcon,
  StackIcon,
  HandshakeIcon,
  LeafIcon,
  LightningIcon,
  ListChecksIcon,
  MapPinIcon,
  MapPinLineIcon,
  PackageIcon,
  PathIcon,
  ShoppingCartIcon,
  TestTubeIcon,
  TruckIcon,
  UsersIcon,
  QuestionIcon,
} from "@phosphor-icons/react/dist/ssr";
import { isActivityEntityType, type ActivityEntityType } from "@/db/schema/common";

export const ACTIVITY_RECORD_TYPE_ICONS: Record<ActivityEntityType, Icon> = {
  credit_batch: CertificateIcon,
  production_run: FactoryIcon,
  feedstock: LeafIcon,
  biochar_product: CubeIcon,
  bin_movement: PackageIcon,
  lab_sample: TestTubeIcon,
  order: ShoppingCartIcon,
  delivery: TruckIcon,
  transport_leg: PathIcon,
  application: MapPinIcon,
  document: FileIcon,
  removal: StackIcon,
  ghg_statement: FileTextIcon,
  emission_entry: LightningIcon,
  formulation: ListChecksIcon,
  supplier: HandshakeIcon,
  supplier_location: MapPinLineIcon,
  customer: UsersIcon,
  customer_location: MapPinLineIcon,
};

/** The icon element for a record type; built here so callers never create a component during render. */
export function activityRecordTypeIcon(entityType: string, size: number): ReactElement {
  const icon = isActivityEntityType(entityType) ? ACTIVITY_RECORD_TYPE_ICONS[entityType] : QuestionIcon;
  return createElement(icon, { size, weight: "bold" });
}
