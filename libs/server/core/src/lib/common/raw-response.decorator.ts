import { SetMetadata } from '@nestjs/common';

export const IS_RAW_RESPONSE = 'http:raw-response';

/**
 * Opts a route out of the `ApiResponse` envelope, so its body reaches the
 * client exactly as the handler returned it.
 *
 * The envelope is the default because one response shape means clients have one
 * unwrapping path and one error path. Opting out is for endpoints whose
 * consumer is not our client — `/health`, which load balancers and uptime
 * probes read, and which they expect to be flat.
 *
 * Use sparingly, and for that reason: a route that opts out has to be handled
 * specially by every caller.
 */
export const RawResponse = () => SetMetadata(IS_RAW_RESPONSE, true);
