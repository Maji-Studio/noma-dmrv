import { Warning } from "@phosphor-icons/react/dist/ssr";
import type { UseFormRegisterReturn } from "react-hook-form";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import { FormField, FormInput } from "@/components/forms";

const WEIGHBRIDGE_MISMATCH_TOLERANCE_RATIO = 0.01;
const DISPLAY_DECIMAL_PLACES = 2;

export function deriveWeighbridgeWetMass(
  arrivalMassKg: unknown,
  departureMassKg: unknown,
): number | null {
  return typeof arrivalMassKg === "number" &&
    Number.isFinite(arrivalMassKg) &&
    typeof departureMassKg === "number" &&
    Number.isFinite(departureMassKg) &&
    departureMassKg >= 0 &&
    arrivalMassKg >= departureMassKg
    ? arrivalMassKg - departureMassKg
    : null;
}

interface TruckWeighingSectionProps {
  arrivalMassKg: unknown;
  departureMassKg: unknown;
  wetMassKg: unknown;
  wetMassLabel: string;
  arrivalRegister: UseFormRegisterReturn;
  departureRegister: UseFormRegisterReturn;
  arrivalError?: string;
  departureError?: string;
  arrivalCertifyRequired?: boolean;
  departureCertifyRequired?: boolean;
  arrivalCertifyStatus?: CertFieldStatus;
  departureCertifyStatus?: CertFieldStatus;
  isSubmitting?: boolean;
}

export function TruckWeighingSection({
  arrivalMassKg,
  departureMassKg,
  wetMassKg,
  wetMassLabel,
  arrivalRegister,
  departureRegister,
  arrivalError,
  departureError,
  arrivalCertifyRequired,
  departureCertifyRequired,
  arrivalCertifyStatus,
  departureCertifyStatus,
  isSubmitting = false,
}: TruckWeighingSectionProps) {
  const observedWetMassKg = deriveWeighbridgeWetMass(
    arrivalMassKg,
    departureMassKg,
  );
  const mismatch =
    observedWetMassKg !== null &&
    typeof wetMassKg === "number" &&
    Number.isFinite(wetMassKg) &&
    Math.abs(wetMassKg - observedWetMassKg) >
      observedWetMassKg * WEIGHBRIDGE_MISMATCH_TOLERANCE_RATIO;

  return (
    <div className="space-y-20">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="truckMassOnArrivalKg"
          label="Truck mass before unloading (kg)"
          error={arrivalError}
          certifyRequired={arrivalCertifyRequired}
          certifyStatus={arrivalCertifyStatus}
        >
          <FormInput
            id="truckMassOnArrivalKg"
            type="number"
            step="any"
            min={0}
            placeholder="e.g., 15000"
            disabled={isSubmitting}
            error={!!arrivalError}
            {...arrivalRegister}
          />
        </FormField>

        <FormField
          id="truckMassOnDepartureKg"
          label="Truck mass after unloading (kg)"
          error={departureError}
          certifyRequired={departureCertifyRequired}
          certifyStatus={departureCertifyStatus}
        >
          <FormInput
            id="truckMassOnDepartureKg"
            type="number"
            step="any"
            min={0}
            placeholder="e.g., 5000"
            disabled={isSubmitting}
            error={!!departureError}
            {...departureRegister}
          />
        </FormField>
      </div>

      {mismatch && observedWetMassKg !== null && (
        <div
          role="alert"
          className="flex items-start gap-12 border border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] p-16"
        >
          <Warning
            size={20}
            weight="fill"
            className="mt-1 shrink-0 text-[var(--color-signal-orange-strong)]"
          />
          <p className="body-small text-[var(--color-text-secondary)]">
            {wetMassLabel} is {wetMassKg.toFixed(DISPLAY_DECIMAL_PLACES)} kg,
            but the observed truck difference is{" "}
            {observedWetMassKg.toFixed(DISPLAY_DECIMAL_PLACES)} kg. Check the
            truck measurements and delivered wet mass before saving.
          </p>
        </div>
      )}
    </div>
  );
}
