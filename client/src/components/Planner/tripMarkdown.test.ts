// FE-PLANNER-TRIPMD-001 onwards: the copy-markdown itinerary builder.
import { describe, expect, it } from 'vitest';

import type { AssignmentsMap, DayNote, Place, Reservation } from '../../types';
import { buildTripMarkdown } from './tripMarkdown';
import type { TripExportData } from './useTripExport';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;
const opts = { t, locale: 'en', timeFormat: '24h' };

function place(over: Partial<Place> = {}): Place {
  return { id: 1, name: 'Eiffel Tower', lat: 48.85, lng: 2.29, category_id: 7, ...over } as Place;
}

function base(over: Partial<TripExportData> = {}): TripExportData {
  return {
    trip: { id: 1, title: 'Paris' } as TripExportData['trip'],
    days: [{ id: 10, trip_id: 1, title: null }],
    places: [],
    assignments: {},
    categories: [{ id: 7, name: 'Sight', color: '#f0a', icon: 'pin' }],
    reservations: [],
    dayNotes: {},
    ...over,
  };
}

describe('buildTripMarkdown', () => {
  it('FE-PLANNER-TRIPMD-001: prints the title, the day heading and numbered stops with their details', () => {
    const assignments: AssignmentsMap = {
      '10': [
        { id: 1, day_id: 10, place_id: 1, order_index: 1 },
        { id: 2, day_id: 10, place_id: 2, order_index: 0 },
      ] as AssignmentsMap['10'],
    };
    const md = buildTripMarkdown(
      base({
        days: [{ id: 10, trip_id: 1, title: null, date: '2026-05-01' }],
        places: [place(), place({ id: 2, name: 'Louvre', address: 'Rue de Rivoli', place_time: '10:00' })],
        assignments,
      }),
      opts
    );
    expect(md).toContain('# Paris');
    expect(md).toContain('## dayplan.dayN:{"n":1}');
    expect(md).toContain('1. Louvre');
    expect(md).toContain('  - dayplan.mdAddress: Rue de Rivoli');
    expect(md).toContain('2. Eiffel Tower');
    expect(md).toContain('  - dayplan.mdCategory: Sight');
  });

  it('FE-PLANNER-TRIPMD-002: day notes land under their own heading, each with its time', () => {
    const dayNotes: Record<string, DayNote[]> = {
      '10': [{ id: 1, day_id: 10, text: 'Book the boat', time: '09:30' }],
    };
    const md = buildTripMarkdown(base({ dayNotes }), opts);
    expect(md).toContain('### dayplan.mdNotes');
    expect(md).toContain('- 09:30 — Book the boat');
  });

  it('FE-PLANNER-TRIPMD-003: a flight booking prints its times, metadata and endpoints', () => {
    const reservations: Reservation[] = [
      {
        id: 1,
        trip_id: 1,
        day_id: 10,
        title: 'CGK → CDG',
        type: 'flight',
        status: 'confirmed',
        reservation_time: '2026-05-01T09:40:00',
        reservation_end_time: '2026-05-01T21:10:00',
        confirmation_number: 'ABC123',
        metadata: JSON.stringify({
          airline: 'GA',
          flight_number: 'GA8',
          departure_airport: 'CGK',
          arrival_airport: 'CDG',
          departure_timezone: 'WIB',
        }),
        endpoints: [
          { role: 'from', sequence: 0, name: 'Soekarno-Hatta', code: 'CGK', lat: 0, lng: 0 },
          { role: 'to', sequence: 1, name: 'Charles de Gaulle', code: 'CDG', lat: 0, lng: 0 },
        ],
      } as unknown as Reservation,
    ];
    const md = buildTripMarkdown(base({ reservations }), opts);
    expect(md).toContain('- CGK → CDG');
    expect(md).toContain('  - dayplan.mdDeparture: Fri, May 1 09:40 (WIB)');
    expect(md).toContain('  - dayplan.mdArrival: Fri, May 1 21:10');
    expect(md).toContain('  - dayplan.mdAirline: GA');
    expect(md).toContain('  - dayplan.mdFlightNo: GA8');
    // The airport codes in the metadata keep the endpoint names out of the way.
    expect(md).not.toContain('Soekarno-Hatta');
    expect(md).toContain('  - dayplan.mdBookingCode: ABC123');
  });

  it('FE-PLANNER-TRIPMD-004: endpoints carry from/to when the metadata has no airport codes', () => {
    const reservations: Reservation[] = [
      {
        id: 1,
        trip_id: 1,
        day_id: 10,
        title: 'Gare de Lyon → Dijon',
        type: 'train',
        status: 'pending',
        metadata: '{"train_number":"6850","seat":"42B"}',
        endpoints: [
          { role: 'from', sequence: 0, name: 'Gare de Lyon', code: 'LYO', lat: 0, lng: 0 },
          { role: 'to', sequence: 1, name: 'Dijon', code: 'DIJ', lat: 0, lng: 0 },
        ],
      } as unknown as Reservation,
    ];
    const md = buildTripMarkdown(base({ reservations }), opts);
    expect(md).toContain('  - dayplan.mdTrainNo: 6850');
    expect(md).toContain('  - dayplan.mdSeat: 42B');
    expect(md).toContain('  - dayplan.mdFrom: Gare de Lyon (LYO)');
    expect(md).toContain('  - dayplan.mdTo: Dijon (DIJ)');
  });

  it('FE-PLANNER-TRIPMD-005: a trip without days says so, and a broken metadata parses to nothing', () => {
    expect(buildTripMarkdown(base({ days: [] }), opts)).toContain('_planner.noDaysPlanned_');
    const reservations: Reservation[] = [
      {
        id: 1,
        trip_id: 1,
        day_id: 10,
        title: 'Dinner',
        type: 'restaurant',
        status: 'pending',
        metadata: '{oops',
      } as unknown as Reservation,
    ];
    const md = buildTripMarkdown(base({ reservations }), opts);
    expect(md).toContain('- Dinner');
    expect(md).not.toContain('dayplan.mdAirline');
  });
});
