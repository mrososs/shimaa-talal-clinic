import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';
import { ClinicModule } from '@clinic/server-clinic';
import { AppointmentService } from './appointment.service';
import { AvailabilityService } from './availability.service';
import { AppointmentsController } from './api/appointments.controller';
import { ClinicAppointmentsController } from './api/clinic-appointments.controller';

/**
 * Booking — appointments and the windows they occupy.
 *
 * Depends on the clinic (for sessions and policy) and on nothing else. It has
 * no idea Queue exists: checking in is a workflow above both, which is what
 * lets each domain stay ignorant of the other.
 */
@Module({
  imports: [ServerCoreModule, ClinicModule],
  controllers: [AppointmentsController, ClinicAppointmentsController],
  providers: [AppointmentService, AvailabilityService],
  exports: [AppointmentService, AvailabilityService],
})
export class BookingModule {}
