import { z } from "zod";
import type { OutputBinStock, OutputBinStockTotals } from "@/lib/output-stock/bin-stock-projection";
import { OUTPUT_DRAW_ORDERS, type OutputDrawOrder } from "@/lib/output-stock/stock-mode";
import { UNRESOLVED_STOCK_SENTENCES } from "@/lib/output-stock/layer-projection";
import { publishKg, publishPercent } from "@/lib/output-stock/stock-precision";

const moistureBasisSchema = z.object({
  source: z.enum(["reading", "recorded"]).describe("A stock count reading or the mass recorded when the layer entered the bin."),
  at: z.iso.datetime().describe("Moisture basis instant in UTC, RFC 3339."),
}).nullable().describe("Source and instant of the moisture estimate, or null when unavailable.");
const figuresShape = {
  dryBiocharKg: z.number().describe("Dry biochar in kilograms, rounded to 3 decimal places."),
  solidsKg: z.number().describe("Dry biochar and ingredient solids in kilograms, rounded to 3 decimal places."),
  estimatedWetKg: z.number().nullable().describe("Estimated wet kilograms, rounded to 3 decimal places, or null when unavailable."),
  estimatedMoisturePercent: z.number().nullable().describe("Estimated moisture as percent of wet mass, rounded to 2 decimal places, or null when unavailable."),
  moistureBasis: moistureBasisSchema,
};

export const outputBinStockRepresentationSchema = z.object({
  storageLocationId: z.uuid().describe("Biochar or product bin identifier, UUID."),
  code: z.string().describe("Human-readable bin code."),
  type: z.enum(["biochar_bin", "product_bin"]).describe("Output material lane of the bin."),
  facilityId: z.uuid().describe("Owning facility identifier, UUID."),
  archivedAt: z.iso.datetime().nullable().describe("Archive instant in UTC, RFC 3339, or null for a live bin."),
  formulationId: z.uuid().nullable().describe("Formulation claimed by a product bin, UUID; null for a biochar bin or an unclaimed product bin."),
  stockMode: z.enum(["split", "mix"]).describe("Current bin layout; a mix pile has one moisture estimate in totals."),
  drawOrder: z.literal([...OUTPUT_DRAW_ORDERS, null]).describe("Without sources, a split bin draws in this order. Null for a mix bin. Sub-bins remain listed oldest first."),
  status: z.enum(["resolved", "unresolved"]).describe("Whether the saved facts resolve the bin stock."),
  unresolvedReason: z.string().nullable().describe("Fixed explanation when stock cannot be resolved, or null when resolved."),
  totals: z.object(figuresShape).nullable().describe("Figures for the whole bin, or null when unresolved. An empty resolved bin holds zero kilograms."),
  subBins: z.array(z.object({
    layerId: z.uuid().describe("Held run or product UUID accepted by a split-bin loss in sources[].layerId."),
    layerKind: z.enum(["production_run", "biochar_product"]).describe("Record that established this layer."),
    code: z.string().describe("Human-readable production run or biochar product code."),
    placedAt: z.iso.datetime().describe("Placement instant in UTC, RFC 3339."),
    ...figuresShape,
  })).describe("Held layers, oldest placement first, then posting order and layer id. Mix layers have null wet mass, moisture and basis. Empty when unresolved."),
});
export type OutputBinStockRepresentation = z.infer<typeof outputBinStockRepresentationSchema>;

function representFigures(figures: OutputBinStockTotals) {
  return {
    dryBiocharKg: publishKg(figures.dryBiocharKg), solidsKg: publishKg(figures.solidsKg),
    estimatedWetKg: figures.estimatedWetKg === null ? null : publishKg(figures.estimatedWetKg),
    estimatedMoisturePercent: figures.estimatedMoisturePercent === null ? null : publishPercent(figures.estimatedMoisturePercent),
    moistureBasis: figures.moistureBasis,
  };
}

/** Publish exact stock once, without an evaluation instant that changes between unchanged reads. */
export function representOutputBinStock(stock: OutputBinStock & { drawOrder: OutputDrawOrder | null }): OutputBinStockRepresentation {
  return outputBinStockRepresentationSchema.parse({
    ...stock.bin, drawOrder: stock.drawOrder, stockMode: stock.stockMode, status: stock.status,
    unresolvedReason: stock.status === "unresolved" ? UNRESOLVED_STOCK_SENTENCES[stock.unresolvedReason] : null,
    totals: stock.totals === null ? null : representFigures(stock.totals),
    subBins: stock.subBins.map((layer) => ({
      layerId: layer.layerId, layerKind: layer.layerKind, code: layer.code, placedAt: layer.placedAt,
      ...representFigures(layer),
    })),
  });
}
