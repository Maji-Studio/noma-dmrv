import type { DbTransaction } from '.';
import * as schema from './schema';
import { DEC_ORG_ID } from './org-defaults';
import { demoId, ids, demoTimestamps, withBootstrapOrg } from './seed-demo-facts';
import { buildSoilTemperatureMeasurements, buildApplicationBoundaryDocuments, buildTransportEvidenceDocuments } from './seed-certification-evidence';
import { storeSyntheticSeedDocuments } from './seed-document-storage';
import { seedOperationalDetails } from './seed-operational-details';
import type { StorageProvider } from '../lib/storage/types';

export async function seedDemoEvidence(tx: DbTransaction, storageProvider: StorageProvider, uploadedSeedDocumentKeys: string[]) {
  const soilTemperatureRows = buildSoilTemperatureMeasurements([
    {
      idBase: 3000,
      applicationId: ids.application1,
      baselineMonth: '2026-05',
      baseTemperatureC: 24.5,
      gpsLatitude: -3.245,
      gpsLongitude: 37.425,
      fieldIdentifier: 'KILEMA-N-12',
    },
    {
      idBase: 3020,
      applicationId: ids.application2,
      baselineMonth: '2026-05',
      baseTemperatureC: 22.8,
      gpsLatitude: -4.789,
      gpsLongitude: 38.312,
      fieldIdentifier: 'USAMBARA-E-1',
    },
    {
      idBase: 3040,
      applicationId: ids.application3,
      baselineMonth: '2026-05',
      baseTemperatureC: 25.2,
      gpsLatitude: -3.289,
      gpsLongitude: 37.198,
      fieldIdentifier: 'MACHAME-S-8',
    },
  ], DEC_ORG_ID);

  console.log(`Creating ${soilTemperatureRows.length} soil temperature measurements...`);
  await tx.insert(schema.soilTemperatureMeasurements).values(soilTemperatureRows);

  console.log('Creating application boundary evidence documents...');
  await tx.insert(schema.documents).values(
    await storeSyntheticSeedDocuments(
      storageProvider,
      buildApplicationBoundaryDocuments([
        {
          id: ids.applicationBoundaryDocument1,
          applicationId: ids.application1,
          applicationCode: 'AP-26-001',
          capturedAt: demoTimestamps.application1Date,
          fieldIdentifier: 'KILEMA-N-12',
          boundaryReference: 'TZ-KLM-KILEMA-N12-2026',
          fileName: 'AP-26-001-boundary-logbook.pdf',
          fileSizeBytes: 184_320,
        },
        {
          id: ids.applicationBoundaryDocument2,
          applicationId: ids.application2,
          applicationCode: 'AP-26-002',
          capturedAt: demoTimestamps.application2Date,
          fieldIdentifier: 'USAMBARA-E-1',
          boundaryReference: 'TZ-TGA-LUSHOTO-E1-2026',
          fileName: 'AP-26-002-boundary-logbook.pdf',
          fileSizeBytes: 171_008,
        },
        {
          id: ids.applicationBoundaryDocument3,
          applicationId: ids.application3,
          applicationCode: 'AP-26-003',
          capturedAt: demoTimestamps.application3Date,
          fieldIdentifier: 'MACHAME-S-8',
          boundaryReference: 'TZ-KLM-MACHAME-S8-2026',
          fileName: 'AP-26-003-boundary-logbook.pdf',
          fileSizeBytes: 176_640,
        },
      ], DEC_ORG_ID),
      uploadedSeedDocumentKeys,
    ),
  );

  console.log('Creating transport evidence documents...');
  await tx.insert(schema.documents).values(
    await storeSyntheticSeedDocuments(
      storageProvider,
      buildTransportEvidenceDocuments([
      {
        id: demoId(3200),
        entityType: 'feedstock',
        entityId: ids.feedstock1,
        documentType: 'weighbridge_ticket',
        fileName: 'FS-26-001-weighbridge-ticket.pdf',
        capturedAt: demoTimestamps.firstDelivery,
        description:
          'Inbound weighbridge ticket recording the Machame-to-Moshi route and delivered mass.',
        evidenceReference: 'WST-FD-26-001',
        fileSizeBytes: 138_240,
      },
      {
        id: demoId(3201),
        entityType: 'feedstock',
        entityId: ids.feedstock2,
        documentType: 'weighbridge_ticket',
        fileName: 'FS-26-002-weighbridge-ticket.pdf',
        capturedAt: demoTimestamps.secondDelivery,
        description:
          'Inbound weighbridge ticket recording the Kilema-to-Moshi route and delivered mass.',
        evidenceReference: 'WST-FD-26-002',
        fileSizeBytes: 142_336,
      },
      {
        id: demoId(3202),
        entityType: 'feedstock',
        entityId: ids.feedstock3,
        documentType: 'bill_of_lading',
        fileName: 'FS-26-003-bill-of-lading.pdf',
        capturedAt: demoTimestamps.thirdDelivery,
        description:
          'Carrier bill of lading for the second hardwood-chip shipment from Machame.',
        evidenceReference: 'BOL-FD-26-003',
        fileSizeBytes: 151_552,
      },
      {
        id: demoId(3203),
        entityType: 'delivery',
        entityId: ids.delivery1,
        documentType: 'bill_of_lading',
        fileName: 'DL-26-001-bill-of-lading.pdf',
        capturedAt: demoTimestamps.delivery1Date,
        description:
          'Signed delivery route and custody record for the Kilema North Plot shipment.',
        evidenceReference: 'BOL-DL-26-001',
        fileSizeBytes: 166_912,
      },
      {
        id: demoId(3204),
        entityType: 'delivery',
        entityId: ids.delivery2,
        documentType: 'bill_of_lading',
        fileName: 'DL-26-002-bill-of-lading.pdf',
        capturedAt: demoTimestamps.delivery2Date,
        description:
          'Signed delivery route and custody record for the Lushoto Estate shipment.',
        evidenceReference: 'BOL-DL-26-002',
        fileSizeBytes: 174_080,
      },
      {
        id: demoId(3205),
        entityType: 'delivery',
        entityId: ids.delivery3,
        documentType: 'weighbridge_ticket',
        fileName: 'DL-26-003-weighbridge-ticket.pdf',
        capturedAt: demoTimestamps.delivery3Date,
        description:
          'Outbound weighbridge and destination route record for the Machame South Plot shipment.',
        evidenceReference: 'WST-DL-26-003',
        fileSizeBytes: 147_456,
      },
      {
        id: demoId(3206),
        entityType: 'transport_leg',
        entityId: ids.transportLegSample1,
        documentType: 'other_transport_evidence',
        fileName: 'SAM-26-001-chain-of-custody.pdf',
        capturedAt: new Date('2026-05-13T09:30:00.000Z'),
        description:
          'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
        evidenceReference: 'COC-SAM-26-001',
        fileSizeBytes: 126_976,
      },
      {
        id: demoId(3207),
        entityType: 'transport_leg',
        entityId: ids.transportLegSample2,
        documentType: 'other_transport_evidence',
        fileName: 'SAM-26-002-chain-of-custody.pdf',
        capturedAt: new Date('2026-05-15T09:00:00.000Z'),
        description:
          'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
        evidenceReference: 'COC-SAM-26-002',
        fileSizeBytes: 129_024,
      },
      {
        id: demoId(3208),
        entityType: 'transport_leg',
        entityId: ids.transportLegSample3,
        documentType: 'other_transport_evidence',
        fileName: 'SAM-26-003-chain-of-custody.pdf',
        capturedAt: new Date('2026-05-17T10:00:00.000Z'),
        description:
          'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
        evidenceReference: 'COC-SAM-26-003',
        fileSizeBytes: 127_488,
      },
      {
        id: demoId(3209),
        entityType: 'transport_leg',
        entityId: ids.transportLegSample4,
        documentType: 'other_transport_evidence',
        fileName: 'SAM-26-004-chain-of-custody.pdf',
        capturedAt: new Date('2026-05-18T08:30:00.000Z'),
        description:
          'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
        evidenceReference: 'COC-SAM-26-004',
        fileSizeBytes: 128_512,
      },
      {
        id: demoId(3210),
        entityType: 'transport_leg',
        entityId: ids.transportLegSample5,
        documentType: 'other_transport_evidence',
        fileName: 'SAM-26-005-chain-of-custody.pdf',
        capturedAt: new Date('2026-05-16T09:15:00.000Z'),
        description:
          'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
        evidenceReference: 'COC-SAM-26-005',
        fileSizeBytes: 130_560,
      },
      {
        id: demoId(3211),
        entityType: 'transport_leg',
        entityId: ids.transportLegSample6,
        documentType: 'other_transport_evidence',
        fileName: 'SAM-26-006-chain-of-custody.pdf',
        capturedAt: new Date('2026-05-17T08:45:00.000Z'),
        description:
          'Courier chain-of-custody form from the Moshi facility to the analysis laboratory.',
        evidenceReference: 'COC-SAM-26-006',
        fileSizeBytes: 131_584,
      },
      ], DEC_ORG_ID),
      uploadedSeedDocumentKeys,
    ),
  );

  // Links the Moshi facility to the Isometric sandbox project +
  // Dark Earth Carbon Template, with the Phase 3.7 emission-estimate
  // config seeded from the Sifuri Halisi LCA. The Isometric facility
  // id stays operator-managed because it must come from Certify UI.
  console.log('Creating Isometric certifier project (Moshi)...');
  await tx.insert(schema.certifierProjects).values(withBootstrapOrg<typeof schema.certifierProjects.$inferInsert>([
    {
      facilityId: ids.facilityMoshi,
      externalProjectId: 'prj_1K9YJ33RKSBX9FFF',
      protocolVersion: '1.1',
      defaultRemovalTemplateId: 'rvt_1KS4S43VPSBXA26X',
      gensetEnergyYieldKwhPerLitre: 3.375,
      defaultSoilTemperatureC: 24.2,
      defaultSoilTemperatureSource:
        'Lembrechts et al. 2022 SoilTemp, 0-5 cm, Kilimanjaro region (annual mean)',
    },
  ]));

  await seedOperationalDetails(tx, DEC_ORG_ID, ids, demoTimestamps);

}
