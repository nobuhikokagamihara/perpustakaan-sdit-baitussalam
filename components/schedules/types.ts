import type {
  AttendanceRecordItem,
  SdClassPreset,
  SessionAttendanceSummary,
  StudentCumulativeRecap,
} from '@/lib/domain/reading-schedule-rules';

export interface ScheduleRow {
  id: number | string;
  schedule_code: string;
  class_name: string;
  grade_level: number;
  homeroom_teacher: string;
  companion_teacher: string;
  student_count: number;
  day_of_week: string;
  schedule_date: string | null;
  start_time: string;
  end_time: string;
  room_area: string;
  reading_mode: string;
  reading_theme: string;
  book_id: number | string | null;
  book_title: string | null;
  status: string;
  students_present: number;
  books_read_count: number;
  session_notes: string;
  completed_at: string | null;
}

export interface ScheduleLogRow {
  id: number | string;
  schedule_id: number | string;
  schedule_code: string;
  class_name: string;
  day_of_week: string;
  start_time?: string;
  end_time?: string;
  room_area?: string;
  reading_mode?: string;
  homeroom_teacher?: string;
  companion_teacher?: string;
  student_count?: number;
  session_date: string;
  status: string;
  students_present: number;
  books_read_count: number;
  notes: string;
  recorded_by_name: string;
  created_at: string;
  attendance?: AttendanceRecordItem[];
  attendance_summary?: SessionAttendanceSummary | null;
}

export interface SchoolClassInfo {
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher: string;
  activeStudentCount: number;
}

export interface ClassStudentRow {
  id: number | string;
  className: string;
  studentCode: string;
  fullName: string;
  gender: 'L' | 'P';
  status: 'Aktif' | 'Nonaktif';
  notes?: string;
  archived?: boolean;
}

export interface BookOption {
  id: number | string;
  title: string;
}

export type LiveClassPreset = SdClassPreset;
export type StudentRecapRow = StudentCumulativeRecap;
