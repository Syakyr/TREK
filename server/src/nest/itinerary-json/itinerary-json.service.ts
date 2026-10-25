import { DomainError } from '../common/domain-error';
import { AssignmentsService } from '../assignments/assignments.service';
import { CategoriesService } from '../categories/categories.service';
import { DayNotesService } from '../day-notes/day-notes.service';
import { DaysService } from '../days/days.service';
import { PlacesService } from '../places/places.service';
import { ReservationsService } from '../reservations/reservations.service';
import { TripsService } from '../trips/trips.service';
import { Injectable } from '@nestjs/common';
import { ITINERARY_JSON_SCHEMA_VERSION } from '@trek/shared';

const MAX_IMPORT_DAYS = 365;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const toArray = (value: unknown): Record<string, any>[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null =>
  value === undefined || value === null || value === '' ? null : String(value);
const num = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

/** The stable reference every exported row carries, and the importer resolves. */
const ref = (prefix: string, id: unknown): string => `${prefix}-${String(id)}`;

/** Domain services hand back typed rows; the document treats them as open records. */
const asRows = (value: unknown): Record<string, any>[] => (Array.isArray(value) ? (value as Record<string, any>[]) : []);

/** A day is found by ref first, then by id, day number or date — the fork's lookup ladder. */
function dayLookupKeys(day: Record<string, any>): string[] {
  return [day.ref, day.id, day.day_number, day.dayNumber, day.date]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map(String);
}

function validatePayload(payload: unknown): asserts payload is Record<string, any> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DomainError(400, 'Import file must contain a JSON object');
  }
  const doc = payload as Record<string, any>;
  const schema = doc.schemaVersion ?? doc.schema_version ?? doc.schema;
  if (schema && schema !== ITINERARY_JSON_SCHEMA_VERSION && schema !== 'trek.itinerary') {
    throw new DomainError(400, `Unsupported itinerary schema: ${schema}`);
  }
  if (doc.version && Number(doc.version) !== 1) {
    throw new DomainError(400, `Unsupported itinerary version: ${doc.version}`);
  }
  if (!doc.trip || typeof doc.trip !== 'object') {
    throw new DomainError(400, 'Itinerary JSON must include a trip object');
  }
  if (!str(doc.trip.title ?? doc.trip.name)) throw new DomainError(400, 'Trip title is required');
  if (JSON.stringify(payload).length > MAX_IMPORT_BYTES) throw new DomainError(400, 'Itinerary JSON is too large');
  if (toArray(doc.days).length > MAX_IMPORT_DAYS) {
    throw new DomainError(400, `Trips can contain at most ${MAX_IMPORT_DAYS} days`);
  }
}

export interface ImportOutcome {
  tripId: number;
  days: number;
  places: number;
  assignments: number;
}

/**
 * The whole trip as one JSON document, and the way back in.
 *
 * The export reads through the same domain services the REST routes use, so it
 * can never print a trip the caller may not open (the guard has already checked
 * access; `exportTrip` re-checks through TripsService.get). The import builds a
 * new trip or appends to an existing one, resolving every row by the `ref` the
 * export wrote — a document edited by hand or by an assistant still lands its
 * places on the right days. Categories and tags are matched by name and created
 * when missing, the same rule the fork's importer used.
 */
@Injectable()
export class ItineraryJsonService {
  constructor(
    private readonly trips: TripsService,
    private readonly days: DaysService,
    private readonly places: PlacesService,
    private readonly assignments: AssignmentsService,
    private readonly dayNotes: DayNotesService,
    private readonly reservations: ReservationsService,
    private readonly categories: CategoriesService,
  ) {}

  async exportTrip(tripId: string, userId: number) {
    const trip = await this.trips.get(tripId, userId);
    if (!trip) throw new DomainError(404, 'Trip not found');
    const days = asRows((await this.days.list(tripId)).days);
    const places = asRows(await this.places.list(String(tripId), { assignment: 'all' } as never));
    const reservations = asRows(await this.reservations.list(tripId));
    const noteLists = await Promise.all(days.map((d) => this.dayNotes.list(d.id, tripId)));

    const assignments: Record<string, any>[] = [];
    for (const day of days) {
      const forDay = asRows(await this.days.getAssignmentsForDay(day.id));
      for (const a of forDay) assignments.push({ ...a, day_ref: ref('day', day.id) });
    }

    return {
      schemaVersion: ITINERARY_JSON_SCHEMA_VERSION,
      version: 1,
      exportedAt: new Date().toISOString(),
      source: { app: 'TREK', tripId: (trip as any).id },
      trip: {
        title: (trip as any).title,
        description: (trip as any).description,
        start_date: (trip as any).start_date,
        end_date: (trip as any).end_date,
        currency: (trip as any).currency,
        reminder_days: (trip as any).reminder_days,
        day_count: (trip as any).day_count,
      },
      days: days.map((d) => ({ ...d, ref: ref('day', d.id) })),
      places: places.map((p) => ({ ...p, ref: ref('place', p.id) })),
      assignments: assignments.map((a) => ({ ...a, ref: ref('assignment', a.id), place_ref: ref('place', a.place_id) })),
      dayNotes: noteLists.flatMap((notes, i) =>
        (notes as Record<string, any>[]).map((n) => ({ ...n, day_ref: ref('day', days[i].id) })),
      ),
      reservations: reservations.map((r) => ({
        ...r,
        ref: ref('reservation', r.id),
        day_ref: r.day_id ? ref('day', r.day_id) : null,
        end_day_ref: r.end_day_id ? ref('day', r.end_day_id) : null,
      })),
      accommodations: [],
    };
  }

  /** Import a document as a brand-new trip owned by `userId`. */
  async importTrip(userId: number, payload: unknown): Promise<ImportOutcome> {
    validatePayload(payload);
    const t = (payload as any).trip ?? {};
    const trip = await this.trips.create(userId, {
      title: str(t.title ?? t.name) as string,
      description: str(t.description),
      start_date: str(t.start_date),
      end_date: str(t.end_date),
      currency: str(t.currency) ?? 'USD',
      reminder_days: num(t.reminder_days) ?? undefined,
      day_count: num(t.day_count) ?? undefined,
    });
    const tripId = (trip as any).id as number;
    const outcome = await this.writeSchedule(String(tripId), payload as Record<string, any>, userId, new Map());
    return { tripId, ...outcome };
  }

  /** Append a document's days/places/assignments to an existing trip. */
  async appendSchedule(tripId: string, payload: unknown, userId: number): Promise<ImportOutcome> {
    validatePayload(payload);
    const outcome = await this.writeSchedule(tripId, payload as Record<string, any>, userId, await this.existingDayMap(tripId));
    return { tripId: Number(tripId), ...outcome };
  }

  /** Existing days keyed by every key an imported day might name them by. */
  private async existingDayMap(tripId: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const day of asRows((await this.days.list(tripId)).days)) {
      for (const key of [...dayLookupKeys(day), ref('day', day.id)]) map.set(key, day.id);
    }
    return map;
  }

  /**
   * The shared body of both imports: days first (matched or created), then
   * places (matched by name+coordinates when appending, else created), then the
   * assignments that tie them to days, the day notes and the bookings.
   */
  private async writeSchedule(
    tripId: string,
    payload: Record<string, any>,
    userId: number,
    dayMap: Map<string, number>,
  ): Promise<{ days: number; places: number; assignments: number }> {
    const categoryByName = new Map((await this.categories.list()).map((c) => [c.name.toLowerCase(), c.id]));

    const createdDays: Record<string, any>[] = [];
    for (const d of toArray(payload.days)) {
      const existing = dayLookupKeys(d).map((k) => dayMap.get(k)).find((id) => id != null);
      if (existing != null) {
        for (const key of dayLookupKeys(d)) dayMap.set(key, existing);
        continue;
      }
      const day = await this.days.create(tripId, str(d.date) ?? undefined, str(d.notes) ?? undefined);
      const title = str(d.title);
      if (title) await this.days.update((day as any).id, { title: null }, { title });
      for (const key of [...dayLookupKeys(d), ref('day', (day as any).id)]) dayMap.set(key, (day as any).id);
      createdDays.push(d);
    }

    const placeMap = new Map<string, number>();
    const existingPlaces = asRows(await this.places.list(tripId, { assignment: 'all' } as never));
    const placeKey = (name: unknown, lat: unknown, lng: unknown) =>
      `${String(name ?? '').trim().toLowerCase()}|${num(lat)?.toFixed(4) ?? ''}|${num(lng)?.toFixed(4) ?? ''}`;
    for (const p of existingPlaces) placeMap.set(ref('place', p.id), p.id);
    const placeByContent = new Map(existingPlaces.map((p) => [placeKey(p.name, p.lat, p.lng), p.id]));

    let placeCount = 0;
    for (const p of toArray(payload.places)) {
      const named = dayMapRef(placeMap, p);
      if (named != null) continue;
      const byContent = placeByContent.get(placeKey(p.name, p.lat, p.lng));
      if (byContent != null) {
        if (p.ref) placeMap.set(String(p.ref), byContent);
        continue;
      }
      const categoryId = await this.resolveCategory(categoryByName, p.category, userId);
      const place = await this.places.create(tripId, {
        name: str(p.name) ?? 'Untitled',
        description: str(p.description),
        lat: num(p.lat),
        lng: num(p.lng),
        address: str(p.address),
        category_id: categoryId,
        price: num(p.price),
        currency: str(p.currency),
        place_time: str(p.place_time),
        end_time: str(p.end_time),
        duration_minutes: num(p.duration_minutes),
        notes: str(p.notes),
        google_place_id: str(p.google_place_id),
        osm_id: str(p.osm_id),
        website: str(p.website),
        phone: str(p.phone),
        transport_mode: str(p.transport_mode),
      } as never);
      const id = (place as any).id as number;
      if (p.ref) placeMap.set(String(p.ref), id);
      placeMap.set(ref('place', id), id);
      placeByContent.set(placeKey(p.name, p.lat, p.lng), id);
      placeCount++;
    }

    let assignmentCount = 0;
    for (const a of toArray(payload.assignments)) {
      const dayId = resolveRef(dayMap, a.day_ref ?? a.day_id);
      const placeId = resolveRef(placeMap, a.place_ref ?? a.place_id);
      if (dayId == null || placeId == null) continue;
      await this.assignments.createAssignment(dayId, placeId, str(a.notes), {
        orderIndex: num(a.order_index) ?? undefined,
      });
      assignmentCount++;
    }

    for (const n of toArray(payload.dayNotes)) {
      const dayId = resolveRef(dayMap, n.day_ref ?? n.day_id);
      if (dayId == null) continue;
      await this.dayNotes.create(dayId, tripId, str(n.text) ?? '', str(n.time), str(n.icon), num(n.sort_order) ?? undefined, str(n.color));
    }

    for (const r of toArray(payload.reservations)) {
      await this.reservations.create(tripId, {
        title: str(r.title) ?? 'Reservation',
        type: str(r.type) ?? 'other',
        status: str(r.status) ?? 'pending',
        day_id: resolveRef(dayMap, r.day_ref ?? r.day_id),
        end_day_id: resolveRef(dayMap, r.end_day_ref ?? r.end_day_id),
        reservation_time: str(r.reservation_time),
        reservation_end_time: str(r.reservation_end_time),
        location: str(r.location),
        confirmation_number: str(r.confirmation_number),
        notes: str(r.notes),
        url: str(r.url),
        metadata: typeof r.metadata === 'string' ? r.metadata : r.metadata ? JSON.stringify(r.metadata) : null,
        endpoints: Array.isArray(r.endpoints) ? r.endpoints : undefined,
      } as never);
    }

    return { days: createdDays.length, places: placeCount, assignments: assignmentCount };
  }

  private async resolveCategory(byName: Map<string, number>, category: unknown, userId: number): Promise<number | null> {
    if (!category || typeof category !== 'object') return num(category);
    const name = str((category as any).name);
    if (!name) return null;
    const existing = byName.get(name.toLowerCase());
    if (existing != null) return existing;
    const created = await this.categories.create(userId, name, str((category as any).color) ?? undefined, str((category as any).icon) ?? undefined);
    byName.set(name.toLowerCase(), created.id);
    return created.id;
  }
}

function dayMapRef(map: Map<string, number>, row: Record<string, any>): number | null {
  return resolveRef(map, row.ref ?? row.id);
}

function resolveRef(map: Map<string, number>, value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  return map.get(String(value)) ?? null;
}
