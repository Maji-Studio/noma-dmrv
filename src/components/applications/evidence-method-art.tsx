/**
 * One drawing per evidence method, shared by the application's evidence cards
 * and the organization's default evidence cards so both show the same picture.
 */

import type { ReactNode } from "react";
import { FieldBoundaryArt, LocationPinArt, PhotoEvidenceArt } from "@/components/ui/illustrations";
import type { ApplicationEvidenceMethod } from "@/schemas/applications";

export const EVIDENCE_METHOD_ART: Record<ApplicationEvidenceMethod, ReactNode> = {
  location: <LocationPinArt />,
  boundary: <FieldBoundaryArt />,
  visual: <PhotoEvidenceArt />,
};
