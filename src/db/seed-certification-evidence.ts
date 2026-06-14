import * as schema from './schema';

const MS_PER_MINUTE = 60_000;
const PRODUCTION_READING_INTERVAL_MINUTES = 5;
const SOIL_TEMPERATURE_MEASUREMENT_DAYS = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28] as const;
const DEMO_EVIDENCE_BASE_URL = 'https://example.com/noma/demo/evidence';

const seedEvidenceId = (n: number) =>
  `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

type ProductionReadingSeedSpec = {
  idBase: number;
  productionRunId: string;
  start: Date;
  end: Date;
  temperatureStartC: number;
  temperaturePeakC: number;
  pressureStartBar: number;
  pressurePeakBar: number;
  gasStartRate: number;
  gasPeakRate: number;
};

type SoilTemperatureSeedSpec = {
  idBase: number;
  applicationId: string;
  baselineMonth: string;
  baseTemperatureC: number;
  gpsLatitude: number;
  gpsLongitude: number;
  fieldIdentifier: string;
};

type BoundaryEvidenceSeedSpec = {
  id: string;
  applicationId: string;
  applicationCode: string;
  capturedAt: Date;
  fieldIdentifier: string;
  boundaryReference: string;
  fileName: string;
  fileSizeBytes: number;
};

export function buildProductionRunReadings(
  specs: ProductionReadingSeedSpec[]
): (typeof schema.productionRunReadings.$inferInsert)[] {
  const intervalMs = PRODUCTION_READING_INTERVAL_MINUTES * MS_PER_MINUTE;

  return specs.flatMap((spec) => {
    const totalSteps = Math.floor((spec.end.getTime() - spec.start.getTime()) / intervalMs);
    const rows: (typeof schema.productionRunReadings.$inferInsert)[] = [];

    for (let step = 0; step <= totalSteps; step += 1) {
      const progress = totalSteps === 0 ? 1 : step / totalSteps;
      const warmupCurve = Math.sin((Math.PI / 2) * Math.min(progress / 0.72, 1));
      const controlledDecline = progress > 0.82 ? (progress - 0.82) * 18 : 0;

      rows.push({
        id: seedEvidenceId(spec.idBase + step),
        productionRunId: spec.productionRunId,
        timestamp: new Date(spec.start.getTime() + step * intervalMs),
        temperatureC: roundTo(
          spec.temperatureStartC +
            (spec.temperaturePeakC - spec.temperatureStartC) * warmupCurve -
            controlledDecline +
            Math.sin(step * 0.9) * 3.2,
          1
        ),
        pressureBar: roundTo(
          spec.pressureStartBar +
            (spec.pressurePeakBar - spec.pressureStartBar) * warmupCurve +
            Math.cos(step * 0.7) * 0.004,
          3
        ),
        gasFlowRate: roundTo(
          spec.gasStartRate +
            (spec.gasPeakRate - spec.gasStartRate) * warmupCurve +
            Math.sin(step * 0.55) * 0.012,
          3
        ),
      });
    }

    return rows;
  });
}

export function buildSoilTemperatureMeasurements(
  specs: SoilTemperatureSeedSpec[]
): (typeof schema.soilTemperatureMeasurements.$inferInsert)[] {
  return specs.flatMap((spec) =>
    SOIL_TEMPERATURE_MEASUREMENT_DAYS.map(
      (day, index): typeof schema.soilTemperatureMeasurements.$inferInsert => ({
        id: seedEvidenceId(spec.idBase + index),
        applicationId: spec.applicationId,
        measurementDate: `${spec.baselineMonth}-${String(day).padStart(2, '0')}`,
        temperatureC: roundTo(
          spec.baseTemperatureC + Math.sin(index * 0.86) * 0.7 + ((index % 3) - 1) * 0.15,
          1
        ),
        measurementMethod: 'calibrated_soil_probe_10cm',
        measurementDepthCm: 10,
        gpsLatitude: roundTo(spec.gpsLatitude + (index - 4.5) * 0.00008, 6),
        gpsLongitude: roundTo(spec.gpsLongitude + ((index % 5) - 2) * 0.00008, 6),
        notes: `${spec.fieldIdentifier} baseline transect ${index + 1}/10`,
      })
    )
  );
}

export function buildApplicationBoundaryDocuments(
  specs: BoundaryEvidenceSeedSpec[]
): (typeof schema.documents.$inferInsert)[] {
  return specs.map((spec): typeof schema.documents.$inferInsert => ({
    id: spec.id,
    entityType: 'application',
    entityId: spec.applicationId,
    documentType: 'pdf',
    fileName: spec.fileName,
    fileUrl: `${DEMO_EVIDENCE_BASE_URL}/${spec.fileName}`,
    fileSizeBytes: spec.fileSizeBytes,
    mimeType: 'application/pdf',
    visibility: 'private',
    uploadStatus: 'uploaded',
    issuedAt: spec.capturedAt,
    capturedAt: spec.capturedAt,
    description: `${spec.applicationCode} GIS boundary logbook and applicator sign-off`,
    metadata: {
      evidenceMethod: 'boundary',
      fieldIdentifier: spec.fieldIdentifier,
      boundaryReference: spec.boundaryReference,
      logbookEvidenceType: 'inventory',
      coordinateSystem: 'EPSG:4326',
      includesApplicatorSignature: true,
    },
  }));
}
