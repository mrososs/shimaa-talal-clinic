export type MessageThreadStatus = 'open' | 'closed';
export type MessagePriority = 'normal' | 'urgent';
export type UrgentCaseStatus = 'pending' | 'accepted' | 'rejected';
export type MessageInboxFilter = 'all' | 'open' | 'unread' | 'urgent' | 'assigned';

export interface UrgentCaseSummary {
  id: string;
  status: UrgentCaseStatus;
  triageNote: string;
  decisionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface MessageThreadSummary {
  id: string;
  guardianId: string;
  childId: string;
  contactName: string;
  childName: string;
  subject: string;
  status: MessageThreadStatus;
  priority: MessagePriority;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  urgentCase: UrgentCaseSummary | null;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  senderType: 'staff' | 'guardian';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface MessageThreadDetail extends MessageThreadSummary {
  messages: ThreadMessage[];
}

export interface QuickReplyTemplate {
  id: string;
  title: string;
  body: string;
}

export interface MessageInbox {
  threads: MessageThreadSummary[];
  templates: QuickReplyTemplate[];
  totalUnread: number;
}

/** Guardian-facing inbox. Staff-only quick-reply templates never cross it. */
export interface ParentMessageInbox {
  threads: MessageThreadSummary[];
  totalUnread: number;
}

export interface CreateParentMessageThreadInput {
  childId: string;
  subject: string;
  initialMessage: string;
  clientRequestId: string;
}

export interface CreateMessageThreadInput {
  guardianId: string;
  childId: string;
  contactName: string;
  childName: string;
  subject: string;
  initialMessage: string;
}

export interface ReplyToThreadInput {
  body: string;
  clientRequestId: string;
}

export interface RaiseUrgentCaseInput {
  triageNote: string;
}

export interface DecideUrgentCaseInput {
  decisionNote?: string | null;
}

export interface AcceptUrgentCaseInput extends DecideUrgentCaseInput {
  sessionId: string;
}

export interface AcceptUrgentCaseResult {
  urgentCase: UrgentCaseSummary;
  queueEntryId: string;
}
