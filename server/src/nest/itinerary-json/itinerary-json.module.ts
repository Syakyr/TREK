import { AssignmentsDomainModule } from '../assignments/assignments-domain.module';
import { CategoriesModule } from '../categories/categories.module';
import { DayNotesModule } from '../day-notes/day-notes.module';
import { DaysModule } from '../days/days.module';
import { ItineraryJsonController } from './itinerary-json.controller';
import { ItineraryJsonService } from './itinerary-json.service';
import { PlacesModule } from '../places/places.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { TripsModule } from '../trips/trips.module';
import { Module } from '@nestjs/common';

/**
 * The itinerary JSON document — the whole trip out as one file and back in,
 * as a new trip or appended to an existing schedule.
 *
 * It owns no tables of its own: it reads and writes through the domain services
 * of the domains it stitches together, so an export can never print more than
 * the REST routes would show, and an import lands every row through the same
 * path a hand-made one takes.
 */
@Module({
  imports: [
    TripsModule,
    DaysModule,
    PlacesModule,
    AssignmentsDomainModule,
    ReservationsModule,
    DayNotesModule,
    CategoriesModule,
  ],
  controllers: [ItineraryJsonController],
  providers: [ItineraryJsonService],
})
export class ItineraryJsonModule {}
