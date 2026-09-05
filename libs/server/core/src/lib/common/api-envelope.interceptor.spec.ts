import {
  NotFoundException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ApiEnvelopeInterceptor, envelope } from './api-envelope.interceptor';
import { apiFailure, apiSuccess } from './api-response.util';
import { IS_RAW_RESPONSE } from './raw-response.decorator';

/**
 * The envelope is the contract `ApiClient` unwraps against, so the failure mode
 * this guards is quiet: a body of the wrong shape is not an error anywhere, it
 * just arrives at a component as `undefined`.
 */

function contextFor(): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function interceptorWith(raw = false): ApiEnvelopeInterceptor {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue(raw ? true : undefined);
  return new ApiEnvelopeInterceptor(reflector);
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

async function run(value: unknown, raw = false): Promise<unknown> {
  return lastValueFrom(
    interceptorWith(raw).intercept(contextFor(), handlerReturning(value)),
  );
}

describe('ApiEnvelopeInterceptor', () => {
  describe('wraps', () => {
    it('an object', async () => {
      await expect(run({ guardian: null })).resolves.toEqual({
        success: true,
        data: { guardian: null },
      });
    });

    it('null', async () => {
      // `data: null` is a real answer — "this user has no guardian yet" — and
      // must survive as one rather than collapsing into an empty body.
      await expect(run(null)).resolves.toEqual({ success: true, data: null });
    });

    it('an array, without treating it as an envelope', async () => {
      await expect(run([{ id: 'a' }, { id: 'b' }])).resolves.toEqual({
        success: true,
        data: [{ id: 'a' }, { id: 'b' }],
      });
    });

    it.each([
      ['a string', 'ok'],
      ['a number', 42],
      ['false', false],
      ['zero', 0],
      ['an empty string', ''],
    ])('%s', async (_label, value) => {
      await expect(run(value)).resolves.toEqual({ success: true, data: value });
    });

    it('undefined, so a command with no payload still reports success', async () => {
      await expect(run(undefined)).resolves.toEqual({
        success: true,
        data: undefined,
      });
    });
  });

  describe('does not double-wrap', () => {
    it('a body a handler already enveloped', async () => {
      // Otherwise a client unwraps once and reads the wrong shape.
      const already = apiSuccess({ id: 'appointment-1' });

      await expect(run(already)).resolves.toEqual(already);
    });

    it('a failure envelope', async () => {
      const already = apiFailure(
        'slot_unavailable',
        'That window just filled.',
      );

      await expect(run(already)).resolves.toEqual(already);
    });
  });

  describe('does not mistake ordinary payloads for envelopes', () => {
    it.each([
      ['a payload whose own field is called success', { success: true }],
      [
        'a payload with success and unrelated keys',
        { success: true, data: 1, extra: 2 },
      ],
      ['a non-boolean success', { success: 'yes', data: 1 }],
      [
        'success true carrying an error instead of data',
        { success: true, error: 'x' },
      ],
      [
        'success false carrying data instead of an error',
        { success: false, data: 1 },
      ],
    ])('%s', async (_label, value) => {
      await expect(run(value)).resolves.toEqual({ success: true, data: value });
    });
  });

  describe('raw routes', () => {
    it('pass through untouched, so /health stays flat for probes', async () => {
      const health = {
        status: 'ok',
        service: 'clinic-api',
        timestamp: '2026-09-05T00:00:00.000Z',
      };

      await expect(run(health, true)).resolves.toEqual(health);
    });

    it('are decided by the same handler-over-class metadata lookup', () => {
      const reflector = new Reflector();
      const spy = jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(true);

      new ApiEnvelopeInterceptor(reflector).intercept(
        contextFor(),
        handlerReturning('anything'),
      );

      const [key, targets] = spy.mock.calls[0];
      expect(key).toBe(IS_RAW_RESPONSE);
      expect(targets).toHaveLength(2);
    });
  });

  describe('errors', () => {
    it('are never converted into a success envelope', async () => {
      const failing: CallHandler = {
        handle: () => throwError(() => new NotFoundException('No such child.')),
      };

      await expect(
        lastValueFrom(interceptorWith().intercept(contextFor(), failing)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reach ApiExceptionFilter unchanged', async () => {
      const cause = new Error('database unreachable');
      const failing: CallHandler = { handle: () => throwError(() => cause) };

      await expect(
        lastValueFrom(interceptorWith().intercept(contextFor(), failing)),
      ).rejects.toBe(cause);
    });
  });
});

describe('envelope', () => {
  it('is exported so the rule can be asserted without an ExecutionContext', () => {
    expect(envelope('x')).toEqual({ success: true, data: 'x' });
    expect(envelope(apiSuccess('x'))).toEqual({ success: true, data: 'x' });
  });
});
