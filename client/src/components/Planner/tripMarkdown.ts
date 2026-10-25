import type { DayNote, Place, Reservation } from '../../types';
import { formatDate, formatTime, splitReservationDateTime } from '../../utils/formatters';
import type { TripExportData } from './useTripExport';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface TripMarkdownOptions {
  t: Translate;
  locale: string;
  timeFormat: string;
}

/** A booking's `metadata` arrives as a JSON string or an object depending on who wrote it. */
function reservationMetadata(reservation: Reservation): Record<string, string> {
  const raw = reservation.metadata;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as unknown as Record<string, string>;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** One `  - Label: value` line under a booking. */
const field = (label: string, value: string | null | undefined): string | null =>
  value ? `  - ${label}: ${value}` : null;

/**
 * The trip as readable markdown: the plan the day planner shows, as text —
 * days with their numbered stops, day notes, and the bookings with their
 * transport detail (times with timezones, flight and train numbers, seats,
 * booking codes, from/to endpoints). Copy-markdown feeds it to the clipboard;
 * it reads well in any markdown viewer, chat or mail.
 */
export function buildTripMarkdown(data: TripExportData, { t, locale, timeFormat }: TripMarkdownOptions): string {
  const lines: string[] = [];
  const placesById = new Map<number, Place>(data.places.map((p) => [p.id, p]));
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));

  lines.push(`# ${data.trip?.title || t('dayplan.export')}`);
  const description = data.trip?.description?.trim();
  if (description) lines.push('', description);

  data.days.forEach((day, index) => {
    const dayAssignments = [...(data.assignments[String(day.id)] || [])].sort((a, b) => a.order_index - b.order_index);
    const dayReservations = data.reservations.filter((r) => r.day_id === day.id || r.end_day_id === day.id);
    const notesForDay = data.dayNotes[String(day.id)] || [];

    lines.push('', `## ${day.title?.trim() || t('dayplan.dayN', { n: index + 1 })}`);
    const date = formatDate(day.date, locale);
    if (date) lines.push(`- ${t('dayplan.mdDate')}: ${date}`);

    if (dayAssignments.length > 0) {
      lines.push('');
      dayAssignments.forEach((assignment, assignmentIndex) => {
        const place = placesById.get(assignment.place_id);
        if (!place) return;
        lines.push(`${assignmentIndex + 1}. ${place.name}`);
        const details = [
          field(t('dayplan.mdTime'), place.place_time ? formatTime(place.place_time, locale, timeFormat) : null),
          field(t('dayplan.mdAddress'), place.address),
          field(t('dayplan.mdCategory'), categoryById.get(place.category_id ?? -1)?.name),
          field(t('dayplan.mdDescription'), place.description),
          field(t('dayplan.mdNotes'), place.notes),
          field(t('dayplan.mdWebsite'), place.website),
        ].filter((l): l is string => l !== null);
        lines.push(...details);
      });
    }

    if (notesForDay.length > 0) {
      lines.push('', `### ${t('dayplan.mdNotes')}`);
      notesForDay.forEach((note: DayNote) => {
        const prefix = note.time ? `${formatTime(note.time, locale, timeFormat)} — ` : '';
        lines.push(`- ${prefix}${note.text}`);
      });
    }

    if (dayReservations.length > 0) {
      lines.push('', `### ${t('reservations.title')}`);
      dayReservations.forEach((reservation) => {
        lines.push(`- ${reservation.title}`);
        lines.push(`  - ${t('dayplan.mdType')}: ${t(`reservations.type.${reservation.type}`)}`);
        lines.push(
          `  - ${t('dayplan.mdStatus')}: ${reservation.status === 'confirmed' ? t('reservations.confirmed') : t('reservations.pending')}`
        );

        const meta = reservationMetadata(reservation);
        // Transports carry departure/arrival as datetimes; anything else keeps
        // the legacy plain date/time pair.
        const departure = splitReservationDateTime(reservation.reservation_time);
        const arrival = splitReservationDateTime(reservation.reservation_end_time);
        const depParts = [
          departure.date ? formatDate(departure.date, locale) : null,
          departure.time ? formatTime(departure.time, locale, timeFormat) : null,
        ].filter(Boolean);
        if (depParts.length) {
          lines.push(
            `  - ${t('dayplan.mdDeparture')}: ${depParts.join(' ')}${meta.departure_timezone ? ` (${meta.departure_timezone})` : ''}`
          );
        }
        const arrParts = [
          arrival.date ? formatDate(arrival.date, locale) : null,
          arrival.time ? formatTime(arrival.time, locale, timeFormat) : null,
        ].filter(Boolean);
        if (arrParts.length) {
          lines.push(
            `  - ${t('dayplan.mdArrival')}: ${arrParts.join(' ')}${meta.arrival_timezone ? ` (${meta.arrival_timezone})` : ''}`
          );
        }
        if (!reservation.reservation_time) {
          const legacyDate = formatDate(reservation.reservation_time ?? null, locale);
          if (legacyDate) lines.push(`  - ${t('dayplan.mdDate')}: ${legacyDate}`);
        }

        lines.push(
          ...[
            field(t('dayplan.mdAirline'), meta.airline),
            field(t('dayplan.mdFlightNo'), meta.flight_number),
            field(t('dayplan.mdTrainNo'), meta.train_number),
            field(t('dayplan.mdPlatform'), meta.platform),
            field(t('dayplan.mdSeat'), meta.seat),
          ].filter((l): l is string => l !== null)
        );

        // The endpoints carry the from/to pair when the metadata has no airport codes.
        const from = reservation.endpoints?.find((e) => e.role === 'from');
        const to = reservation.endpoints?.find((e) => e.role === 'to');
        if (from?.name && !meta.departure_airport) {
          lines.push(`  - ${t('dayplan.mdFrom')}: ${from.name}${from.code ? ` (${from.code})` : ''}`);
        }
        if (to?.name && !meta.arrival_airport) {
          lines.push(`  - ${t('dayplan.mdTo')}: ${to.name}${to.code ? ` (${to.code})` : ''}`);
        }

        lines.push(
          ...[
            field(t('dayplan.mdLocation'), reservation.location),
            field(t('dayplan.mdBookingCode'), reservation.confirmation_number),
            field(t('dayplan.mdNotes'), reservation.notes),
            field(t('dayplan.mdUrl'), reservation.url),
          ].filter((l): l is string => l !== null)
        );
      });
    }
  });

  if (data.days.length === 0) lines.push('', `_${t('planner.noDaysPlanned')}_`);

  return lines.join('\n').trim();
}
