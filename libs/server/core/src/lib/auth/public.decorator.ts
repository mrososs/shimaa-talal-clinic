import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'auth:public';

/**
 * Opts a route out of authentication.
 *
 * The guard is registered globally, so the default is protected and reaching an
 * endpoint without a token is a 401. That direction matters: forgetting to add
 * a guard silently exposes an endpoint, whereas forgetting to add `@Public()`
 * merely breaks it loudly.
 *
 * Use sparingly. Today `/health` is the only route that carries it.
 */
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);
