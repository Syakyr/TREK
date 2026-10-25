import { z } from 'zod';

/**
 * The itinerary JSON contract — the whole trip as one portable document.
 *
 * `trek-itinerary-v1` mirrors what the export prints: the trip header, its days,
 * places, day assignments, day notes, bookings (with endpoints) and stays.
 * Every row carries a stable `ref` ("day-12", "place-7") so a document can be
 * edited — by hand or by an assistant — and imported back with its references
 * intact. The inner rows stay open records on purpose: the document is a
 * snapshot of the plan, and a newer export must still import into an older
 * install.
 */
export const ITINERARY_JSON_SCHEMA_VERSION = 'trek-itinerary-v1';

const row = z.record(z.string(), z.unknown());

export const itineraryJsonDocumentSchema = z.object({
  schemaVersion: z.string(),
  version: z.number(),
  exportedAt: z.string(),
  source: row,
  trip: row,
  days: z.array(row),
  places: z.array(row),
  assignments: z.array(row),
  dayNotes: z.array(row),
  reservations: z.array(row),
  accommodations: z.array(row),
});
export type ItineraryJsonDocument = z.infer<typeof itineraryJsonDocumentSchema>;

/** GET /api/trips/:tripId/export.json */
export const itineraryJsonExportResponseSchema = itineraryJsonDocumentSchema;

/**
 * POST /api/trips/import-json and /api/trips/:tripId/import-schedule-json.
 * The document itself is validated by the service, which answers the bespoke
 * "Unsupported itinerary schema" / "Trip title is required" bodies.
 */
export const itineraryJsonImportRequestSchema = z.object({ itinerary: z.unknown() });
export type ItineraryJsonImportRequest = z.infer<typeof itineraryJsonImportRequestSchema>;

/** What both imports answer: the trip that received the document and what landed. */
export const itineraryJsonImportResponseSchema = z.object({
  success: z.literal(true),
  tripId: z.number(),
  days: z.number(),
  places: z.number(),
  assignments: z.number(),
});
export type ItineraryJsonImportResponse = z.infer<typeof itineraryJsonImportResponseSchema>;
