export const AttendanceIntent = {
  Unknown: 'unknown',
  Coming: 'coming',
  NotComing: 'not_coming',
} as const;

export type AttendanceIntent =
  (typeof AttendanceIntent)[keyof typeof AttendanceIntent];
