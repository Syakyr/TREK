import { User } from '../../types';
import { CurrentUser } from '../auth-core/current-user.decorator';
import { JwtAuthGuard } from '../auth-core/jwt-auth.guard';
import { ResponseContract } from '../common/response-contract';
import { RequirePermission, TripAccessGuard } from '../permissions/trip-access.guard';
import { ItineraryJsonService } from './itinerary-json.service';
import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { ItineraryJsonDocument, ItineraryJsonImportResponse } from '@trek/shared';
import { itineraryJsonExportResponseSchema, itineraryJsonImportResponseSchema } from '@trek/shared';

/**
 * /api/trips/:tripId/export.json, /api/trips/import-json and
 * /api/trips/:tripId/import-schedule-json — the trip as one portable JSON
 * document, out and back in.
 *
 * The export is a read of the trip (access already checked by the guard and
 * re-checked through TripsService.get); the new-trip import creates a trip the
 * caller owns, and the append import mutates an existing trip's schedule, so it
 * demands 'day_edit', the same action the day plan writes under. The document
 * itself is validated in the service, which answers the bespoke
 * "Unsupported itinerary schema" / "Trip title is required" bodies.
 */
@Controller('api/trips')
@UseGuards(JwtAuthGuard)
export class ItineraryJsonController {
  constructor(private readonly itinerary: ItineraryJsonService) {}

  @Get(':tripId/export.json')
  @UseGuards(TripAccessGuard)
  @ResponseContract(itineraryJsonExportResponseSchema)
  async export(@CurrentUser() user: User, { tripId }: { tripId: string }): Promise<ItineraryJsonDocument> {
    return (await this.itinerary.exportTrip(tripId, user.id)) as ItineraryJsonDocument;
  }

  @Post('import-json')
  @ResponseContract(itineraryJsonImportResponseSchema)
  async importNew(@CurrentUser() user: User, @Body() body: { itinerary: unknown }): Promise<ItineraryJsonImportResponse> {
    const outcome = await this.itinerary.importTrip(user.id, body?.itinerary ?? body);
    return { success: true, ...outcome };
  }

  @Post(':tripId/import-schedule-json')
  @UseGuards(TripAccessGuard)
  @RequirePermission('day_edit')
  @HttpCode(200)
  @ResponseContract(itineraryJsonImportResponseSchema)
  async append(
    @CurrentUser() user: User,
    { tripId }: { tripId: string },
    @Body() body: { itinerary: unknown },
  ): Promise<ItineraryJsonImportResponse> {
    const outcome = await this.itinerary.appendSchedule(tripId, body?.itinerary ?? body, user.id);
    return { success: true, ...outcome };
  }
}
