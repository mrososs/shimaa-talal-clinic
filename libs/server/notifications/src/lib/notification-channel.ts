/**
 * The seam every outbound message will travel through.
 *
 * No provider is integrated: there is no Twilio, no WhatsApp Business API, no
 * Firebase Cloud Messaging anywhere in this repository. Declaring the token and
 * the channel vocabulary now means the rest of the platform can express *what*
 * it wants sent long before we decide *who* sends it.
 *
 * Phase 2 adds the `send` operation and at least one implementation.
 */
export type NotificationChannelKind = 'whatsapp' | 'sms' | 'push';

export interface NotificationChannel {
  readonly kind: NotificationChannelKind;
}

/** Multi-provider token: implementations will be registered as an array. */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');
