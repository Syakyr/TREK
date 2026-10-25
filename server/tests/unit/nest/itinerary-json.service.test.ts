/**
 * ItineraryJsonService unit tests: the document shape, the import validation
 * bodies, and the ref-resolution ladder of both imports — against stubbed
 * domain services, so the mapping logic is what fails when it fails.
 */
import { DomainError } from '../../../src/nest/common/domain-error';
import { ItineraryJsonService } from '../../../src/nest/itinerary-json/itinerary-json.service';

const svc = (over: Record<string, unknown> = {}) => {
  const calls: Record<string, unknown[]> = { place: [], assignment: [], note: [], reservation: [], day: [] };
  let daySeed = 100;
  const trips = { get: vi.fn(async () => ({ id: 7, title: 'Rome', currency: 'EUR' })), create: vi.fn(async () => ({ id: 42 })) };
  const days = {
    list: vi.fn(async () => ({ days: over.existingDays ?? [] })),
    create: vi.fn(async (_t: string, date?: string) => ({ id: ++daySeed, date })),
    update: vi.fn(async () => ({})),
    getAssignmentsForDay: vi.fn(async (dayId: number) => (over.assignmentsByDay?.[dayId] ?? [])),
  };
  const places = {
    list: vi.fn(async () => over.existingPlaces ?? []),
    create: vi.fn(async (_t: string, body: Record<string, unknown>) => {
      calls.place.push(body);
      return { id: 200 + calls.place.length, ...body };
    }),
  };
  const assignments = {
    createAssignment: vi.fn(async (dayId: number, placeId: number) => {
      calls.assignment.push([dayId, placeId]);
      return { id: 300 };
    }),
  };
  const dayNotes = { list: vi.fn(async () => over.notesByDay ?? []), create: vi.fn(async () => ({})) };
  const reservations = { list: vi.fn(async () => []), create: vi.fn(async () => ({ id: 400 })) };
  const categories = { list: vi.fn(async () => [{ id: 5, name: 'Sight' }]), create: vi.fn(async (_u: number, name: string) => ({ id: 9, name })) };
  const service = new ItineraryJsonService(
    trips as never, days as never, places as never, assignments as never, dayNotes as never, reservations as never, categories as never,
  );
  return { service, calls, trips, days, places, assignments, dayNotes, reservations, categories };
};

const doc = {
  schemaVersion: 'trek-itinerary-v1',
  version: 1,
  trip: { title: 'Rome', start_date: '2026-06-01' },
  days: [{ ref: 'day-1', date: '2026-06-01', title: 'Arrival' }],
  places: [{ ref: 'place-1', name: 'Colosseum', lat: 41.89, lng: 12.49, category: { name: 'Sight' } }],
  assignments: [{ day_ref: 'day-1', place_ref: 'place-1', order_index: 0 }],
  dayNotes: [{ day_ref: 'day-1', text: 'Buy tickets' }],
  reservations: [{ title: 'Flight', type: 'flight', day_ref: 'day-1', metadata: { airline: 'RY' } }],
};

describe('ItineraryJsonService', () => {
  it('IJ-001: the export stamps every row with its ref and keeps the trip header', async () => {
    const { service } = svc({
      existingDays: [{ id: 10, day_number: 1, date: '2026-06-01' }],
      existingPlaces: [{ id: 20, name: 'Colosseum', lat: 41.89, lng: 12.49 }],
      assignmentsByDay: { 10: [{ id: 30, day_id: 10, place_id: 20 }] },
    });
    const out = await service.exportTrip('7', 1);
    expect(out.schemaVersion).toBe('trek-itinerary-v1');
    expect(out.trip.title).toBe('Rome');
    expect(out.days[0].ref).toBe('day-10');
    expect(out.places[0].ref).toBe('place-20');
    expect(out.assignments[0]).toMatchObject({ day_ref: 'day-10', place_ref: 'place-20' });
  });

  it('IJ-002: a foreign schema, a missing title or a non-object all answer their own 400', async () => {
    const { service } = svc();
    await expect(service.importTrip(1, { schemaVersion: 'other', trip: { title: 'x' } })).rejects.toThrow(DomainError);
    await expect(service.importTrip(1, { trip: {} })).rejects.toThrow('Trip title is required');
    await expect(service.importTrip(1, 'nope')).rejects.toThrow('Import file must contain a JSON object');
  });

  it('IJ-003: importing a document creates the trip, then days, places, assignments, notes and bookings by ref', async () => {
    const { service, calls, trips, places, assignments, dayNotes, reservations } = svc();
    const out = await service.importTrip(1, doc);
    expect(out).toEqual({ tripId: 42, days: 1, places: 1, assignments: 1 });
    expect(trips.create).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Rome', start_date: '2026-06-01' }));
    expect(places.create.mock.calls[0][1]).toMatchObject({ name: 'Colosseum', category_id: 5 });
    expect(assignments.createAssignment).toHaveBeenCalledWith(101, 201, null, { orderIndex: 0 });
    expect(dayNotes.create).toHaveBeenCalledWith(101, '42', 'Buy tickets', null, null, undefined, null);
    expect(reservations.create.mock.calls[0][1]).toMatchObject({ title: 'Flight', day_id: 101, metadata: '{"airline":"RY"}' });
  });

  it('IJ-004: appending matches days by date and places by name+coordinates instead of duplicating them', async () => {
    const { service, calls, days, places, assignments } = svc({
      existingDays: [{ id: 11, day_number: 1, date: '2026-06-01' }],
      existingPlaces: [{ id: 21, name: 'Colosseum', lat: 41.89, lng: 12.49 }],
    });
    const out = await service.appendSchedule('7', doc, 1);
    expect(days.create).not.toHaveBeenCalled();
    expect(places.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ tripId: 7, days: 0, places: 0, assignments: 1 });
    expect(calls.assignment).toEqual([[11, 21]]);
  });
});
