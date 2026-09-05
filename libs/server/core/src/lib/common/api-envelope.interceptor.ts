import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { ApiResponse } from '@clinic/contracts';
import { apiSuccess } from './api-response.util';
import { IS_RAW_RESPONSE } from './raw-response.decorator';

/**
 * Makes the success half of the `ApiResponse` envelope real.
 *
 * `ApiExceptionFilter` has always guaranteed the failure shape. Without this,
 * the success shape was only a convention every controller had to remember, and
 * one handler forgetting `apiSuccess()` would hand `ApiClient` a body it
 * unwraps to `undefined` — a silent, shapeless failure rather than a loud one.
 *
 * Controllers now return plain application data and this puts the envelope on.
 *
 * Errors do not pass through here. `map` only sees the success channel, so a
 * thrown exception travels straight to `ApiExceptionFilter` and is never
 * dressed up as `success: true`.
 *
 * Registered as `APP_INTERCEPTOR` in `apps/api` rather than in a library
 * module, for the same reason as the guards: `ServerCoreModule` is imported by
 * every domain, and a global provider declared there would be registered once
 * per import.
 */
@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.isRaw(context)) {
      return next.handle();
    }

    return next.handle().pipe(map((data: unknown) => envelope(data)));
  }

  private isRaw(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_RAW_RESPONSE, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}

/**
 * Wrap, unless it is already wrapped.
 *
 * A handler that still calls `apiSuccess()` itself — during a migration, or out
 * of habit — would otherwise produce `{ success: true, data: { success: true,
 * data: … } }`, which a client unwraps once and then reads the wrong shape from.
 */
export function envelope(data: unknown): ApiResponse<unknown> {
  return isEnvelope(data) ? data : apiSuccess(data);
}

/**
 * Recognises an already-enveloped body.
 *
 * Deliberately strict: exactly the two keys the envelope has, and the partner
 * key that matches the discriminant. A payload that merely happens to carry a
 * `success` field — the result of some operation, say — is not mistaken for one.
 */
function isEnvelope(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('success')) {
    return false;
  }

  const candidate = value as { success?: unknown };
  if (candidate.success === true) {
    return keys.includes('data');
  }
  if (candidate.success === false) {
    return keys.includes('error');
  }
  return false;
}
