/**
 * ApplicationCard component
 * Displays a single application record with key details
 */
"use client";

import { format } from "date-fns";
import { PencilSimple, Trash, MapPin, Thermometer } from "@phosphor-icons/react/dist/ssr";
import type { Application } from "@/db/schema/application";
import {
  formatApplicationStatus,
  formatApplicationMethod,
  formatSoilTemperatureSource,
} from "@/schemas/applications";
import { formatApplicationKgFromTons } from "./mass-utils";

interface ApplicationCardProps {
  application: Application;
  onEdit?: (application: Application) => void;
  onDelete?: (applicationId: string) => void;
}

export function ApplicationCard({
  application,
  onEdit,
  onDelete,
}: ApplicationCardProps) {
  const hasGps = application.gpsLatitude != null && application.gpsLongitude != null;
  const hasSoilTemp = application.soilTemperatureC != null;
  return (
    <div className="border border-[var(--color-border-primary)] rounded-[var(--radius-8)] p-24 bg-[var(--color-background-light)] hover:border-[var(--color-border-secondary)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-16">
        <div>
          <h3 className="title-heading-4 mb-16">{application.code}</h3>
          <p className="body-small text-[var(--color-text-secondary)]">
            Applied: {format(new Date(application.applicationDate), "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-16">
          <span
            className={`px-16 py-16 rounded-[var(--radius-4)] text-[var(--text-xs)] font-medium ${
              application.status === "applied"
                ? "bg-[var(--color-success-light)] text-[var(--color-success)]"
                : "bg-[var(--color-warning-light)] text-[var(--color-warning)]"
            }`}
          >
            {formatApplicationStatus(application.status as "delivered" | "applied")}
          </span>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-16 mb-16">
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase">
            Biochar Applied
          </p>
          <p className="body-medium font-medium">
            {formatApplicationKgFromTons(application.biocharAppliedTons)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase">
            Dry Biochar
          </p>
          <p className="body-medium font-medium">
            {formatApplicationKgFromTons(application.biocharAppliedDryTons)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase">
            Field Size
          </p>
          <p className="body-medium font-medium">
            {application.fieldSizeHa?.toFixed(2) ?? "-"} ha
          </p>
        </div>
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase">
            Crop Type
          </p>
          <p className="body-medium font-medium">
            {application.cropType || "-"}
          </p>
        </div>
      </div>

      {/* Field Details Row */}
      <div className="flex flex-wrap gap-16 mb-16 text-[var(--text-s)] text-[var(--color-text-secondary)]">
        {application.fieldIdentifier && (
          <span>Field: {application.fieldIdentifier}</span>
        )}
        {application.applicationMethodType && (
          <span>
            Method: {formatApplicationMethod(application.applicationMethodType as "manual" | "mechanical")}
          </span>
        )}
      </div>

      {/* Indicators Row */}
      <div className="flex flex-wrap items-center gap-16 mb-16">
        {hasGps && (
          <div className="flex items-center gap-16 text-[var(--text-s)] text-[var(--color-text-secondary)]">
            <MapPin size={16} />
            <span>
              {application.gpsLatitude?.toFixed(4)}, {application.gpsLongitude?.toFixed(4)}
            </span>
          </div>
        )}
        {hasSoilTemp && (
          <div className="flex items-center gap-16 text-[var(--text-s)] text-[var(--color-text-secondary)]">
            <Thermometer size={16} />
            <span>
              {application.soilTemperatureC?.toFixed(1)}°C
              {application.soilTemperatureSource && (
                <span className="text-[var(--color-text-tertiary)]">
                  {" "}
                  ({formatSoilTemperatureSource(application.soilTemperatureSource as "baseline" | "global_database")})
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* CO2e if available */}
      {application.co2eStoredTonnes != null && (
        <div className="mb-16 p-16 bg-[var(--color-success-light)] rounded-[var(--radius-4)]">
          <p className="text-[var(--text-s)] text-[var(--color-success)] font-medium">
            CO2e Stored: {application.co2eStoredTonnes.toFixed(2)} tonnes
          </p>
        </div>
      )}

      {/* Actions */}
      {(onEdit || onDelete) && (
        <div className="flex items-center gap-16 pt-24 border-t border-[var(--color-border-secondary)]">
          {onEdit && (
            <button
              onClick={() => onEdit(application)}
              className="flex items-center gap-8 px-12 py-6 text-[var(--text-s)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <PencilSimple size={16} />
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(application.id)}
              className="flex items-center gap-8 px-12 py-6 text-[var(--text-s)] text-[var(--color-error)] hover:text-[var(--color-error-dark)] transition-colors"
            >
              <Trash size={16} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
