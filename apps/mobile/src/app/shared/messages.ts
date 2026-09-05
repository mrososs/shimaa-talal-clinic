import { ApiClientError } from '@clinic/api-client';
import type { AuthErrorCode } from '@clinic/client-auth';

/**
 * Every failure a parent can see, in Arabic, in one place.
 *
 * A screen never renders a Supabase message, an HTTP status or an API error
 * code. Those are English, they change without notice, and some of them name
 * internals. Mapping them once here is what lets a screen say something a
 * parent can act on.
 */

const AUTH_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  email_not_confirmed: 'يلزم تأكيد البريد الإلكتروني أولاً.',
  email_taken: 'هذا البريد الإلكتروني مسجَّل بالفعل. جرِّبي تسجيل الدخول.',
  email_invalid: 'هذا البريد الإلكتروني غير صالح. تحقّقي منه وأعيدي المحاولة.',
  weak_password: 'كلمة المرور قصيرة جداً — ٨ أحرف على الأقل.',
  rate_limited: 'محاولات كثيرة. انتظري قليلاً ثم أعيدي المحاولة.',
  network: 'تعذَّر الاتصال. تحقّقي من الإنترنت وأعيدي المحاولة.',
  unknown: 'حدث خطأ غير متوقع. أعيدي المحاولة.',
};

export function authMessage(code: AuthErrorCode | null): string | null {
  return code === null ? null : AUTH_MESSAGES[code];
}

/**
 * Domain errors the identity endpoints return, worded for a parent.
 *
 * The unmapped case deliberately does not fall through to the server's own
 * message: those are written for a developer reading a log.
 */
const API_MESSAGES: Record<string, string> = {
  guardian_phone_taken:
    'هذا الرقم مسجَّل بالفعل لدى العيادة. تواصلي مع الاستقبال لربط الحساب.',
  invalid_phone: 'رقم الهاتف غير صحيح. مثال: ٠١٠١٢٣٤٥٦٧٨',
  auth_user_already_linked: 'هذا الحساب مرتبط بملف عائلي بالفعل.',
  guardian_already_claimed: 'هذا الملف مرتبط بحساب آخر.',
  claim_code_invalid: 'الرمز غير صحيح. تأكّدي منه مع الاستقبال.',
  claim_code_expired: 'انتهت صلاحية الرمز. اطلبي رمزاً جديداً من الاستقبال.',
  claim_code_locked: 'محاولات كثيرة. اطلبي رمزاً جديداً من الاستقبال.',
  child_not_found: 'لم نعثر على هذا الطفل.',
  guardian_not_found: 'لم نعثر على هذا الملف.',
};

export function apiMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const mapped = API_MESSAGES[error.error.code];
    if (mapped !== undefined) return mapped;

    // A validation failure means the form let something through. Say which
    // kind of problem it is without quoting the server.
    if (error.status === 400) return 'تحقّقي من البيانات المُدخلة.';
    if (error.status === 401) return 'انتهت الجلسة. سجّلي الدخول من جديد.';
    if (error.status === 403) return 'لا تملكين صلاحية لهذا الإجراء.';
    if (error.status === 404) return 'لم نعثر على المطلوب.';
    if (error.status === 409) return 'تعذَّر إتمام العملية — حدّثي الصفحة.';
  }
  return 'تعذَّر إتمام العملية. أعيدي المحاولة.';
}
