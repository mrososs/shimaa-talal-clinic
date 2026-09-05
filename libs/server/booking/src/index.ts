/**
 * `@clinic/server-booking` — appointments and availability.
 *
 * Owns the booked visit: when a family is expected, which arrival window they
 * hold, and the lifecycle from request to completion. Owns nothing about the
 * queue — `checked_in` here means only that a queue entry exists somewhere
 * else, and this library cannot tell you who is waiting.
 *
 * Intent-shaped services only; row shapes and SQL stay private.
 */
export * from './lib/booking.module';
export {
  AppointmentService,
  SEAT_RETRY_SLACK,
  type CreateAppointmentInput,
  type TransitionActor,
} from './lib/appointment.service';
export {
  AvailabilityService,
  type AvailabilityQuery,
} from './lib/availability.service';
export { BookingError, BookingErrorCode } from './lib/booking.errors';
