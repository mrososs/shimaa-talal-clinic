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
  phone_invalid: 'رقم الموبايل غير صالح. تحقّقي منه وأعيدي المحاولة.',
  weak_password: 'كلمة المرور قصيرة جداً — ٨ أحرف على الأقل.',
  otp_invalid: 'رمز التحقق غير صحيح. تحقّقي من الأرقام وحاولي مرة أخرى.',
  otp_expired: 'انتهت صلاحية رمز التحقق. اطلبي رمزاً جديداً.',
  otp_delivery_failed:
    'تعذّر إرسال رسالة التحقق الآن. حاولي لاحقاً أو استخدمي البريد الإلكتروني.',
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
  verified_phone_mismatch:
    'استخدمي رقم الموبايل الذي تم التحقق منه، أو سجّلي الدخول برقم آخر.',
  auth_user_already_linked: 'هذا الحساب مرتبط بملف عائلي بالفعل.',
  guardian_already_claimed: 'هذا الملف مرتبط بحساب آخر.',
  claim_code_invalid: 'الرمز غير صحيح. تأكّدي منه مع الاستقبال.',
  claim_code_expired: 'انتهت صلاحية الرمز. اطلبي رمزاً جديداً من الاستقبال.',
  claim_code_locked: 'محاولات كثيرة. اطلبي رمزاً جديداً من الاستقبال.',
  child_not_found: 'لم نعثر على هذا الطفل.',
  guardian_not_found: 'لم نعثر على هذا الملف.',

  // Booking.
  slot_unavailable: 'امتلأت هذه الفترة للتو. اختاري فترة أخرى.',
  session_unavailable: 'هذه الفترة غير متاحة للحجز.',
  window_in_past: 'هذه الفترة بدأت بالفعل.',
  cancellation_too_late: 'فات وقت الإلغاء المسموح به. تواصلي مع الاستقبال.',
  appointment_not_found: 'لم نعثر على هذا الموعد.',
  child_not_accessible: 'لم نعثر على هذا الطفل في ملفك.',

  // The queue. Worded as what to do next, not as a refusal.
  queue_defer_limit_reached: 'استخدمتِ كل مرات تأجيل الدور المتاحة اليوم.',
  queue_invalid_transition: 'تغيّر دورك للتو — حدّثنا الشاشة.',
  queue_entry_not_found: 'لم نعثر على دورك في الطابور.',
  queue_session_not_running: 'الطابور متوقف مؤقتاً الآن.',
  queue_conflict: 'تغيّر الطابور للتو — حدّثنا الشاشة.',

  // Messages and urgent guidance.
  message_thread_not_found: 'لم نعثر على هذه المحادثة.',
  message_thread_closed:
    'أغلقت العيادة هذه المحادثة. ابدئي محادثة جديدة للمتابعة.',
  message_invalid_participant: 'لم نعثر على الطفل في ملفك.',
  urgent_case_not_found: 'لم نعثر على الحالة العاجلة.',
  urgent_case_already_decided: 'راجعت العيادة هذه الحالة بالفعل.',

  // Payments.
  payment_not_found: 'هذا الموعد غير متاح للدفع الآن.',
  payment_invalid_transition:
    'توجد عملية دفع لهذا الموعد قيد المعالجة. حدّثي الصفحة بعد قليل.',
  payment_invalid_receipt:
    'اختاري إيصال PDF أو صورة بحجم لا يزيد عن ٥ ميجابايت.',
  payment_instapay_unavailable:
    'الدفع عبر InstaPay غير متاح حالياً. اختاري الدفع في العيادة.',
  payment_storage_failed: 'تعذّر رفع الإيصال الآن. احتفظي به وحاولي مرة أخرى.',
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
