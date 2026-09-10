export const MessagesErrorCode = {
  ThreadNotFound: 'message_thread_not_found',
  ThreadClosed: 'message_thread_closed',
  NoDoctorAvailable: 'message_no_doctor_available',
  UrgentCaseNotFound: 'urgent_case_not_found',
  UrgentCaseAlreadyDecided: 'urgent_case_already_decided',
  InvalidParticipant: 'message_invalid_participant',
} as const;

export type MessagesErrorCode =
  (typeof MessagesErrorCode)[keyof typeof MessagesErrorCode];

export class MessagesError extends Error {
  constructor(
    readonly code: MessagesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MessagesError';
  }
}
