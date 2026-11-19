'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCheck,
  CheckCircle2,
  GraduationCap,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Button,
  ErrorState,
  LoadingState,
  Modal,
  SelectField,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { formatIsoDate } from '@/lib/domain/library-rules';
import {
  ATTENDANCE_STATUSES,
  summarizeSessionAttendance,
  type AttendanceStatus,
} from '@/lib/domain/reading-schedule-rules';
import { cn } from '@/lib/utils';
import type { ClassStudentRow, ScheduleRow } from './types';

interface DraftAttendanceRow {
  studentId: number | string;
  studentCode: string;
  studentName: string;
  status: AttendanceStatus;
  booksRead: number;
  note: string;
}

interface SessionAttendanceModalProps {
  schedule: ScheduleRow;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const STATUS_BUTTON_STYLES: Record<AttendanceStatus, { active: string; idle: string }> = {
  Hadir: {
    active: 'border-emerald-700 bg-emerald-700 text-white',
    idle: 'border-[#E2DFD7] bg-white text-[#4A4945] hover:border-emerald-400 hover:text-emerald-800',
  },
  Izin: {
    active: 'border-amber-600 bg-amber-600 text-white',
    idle: 'border-[#E2DFD7] bg-white text-[#4A4945] hover:border-amber-400 hover:text-amber-800',
  },
  Sakit: {
    active: 'border-sky-700 bg-sky-700 text-white',
    idle: 'border-[#E2DFD7] bg-white text-[#4A4945] hover:border-sky-400 hover:text-sky-800',
  },
  Alpa: {
    active: 'border-[#C94A43] bg-[#C94A43] text-white',
    idle: 'border-[#E2DFD7] bg-white text-[#4A4945] hover:border-[#E56B63] hover:text-[#9E352F]',
  },
};

export function SessionAttendanceModal({
  schedule,
  onClose,
  onSaved,
}: SessionAttendanceModalProps) {
  const { showToast } = useToast();
  const [status, setStatus] = useState('Selesai');
  const [sessionDate, setSessionDate] = useState(() => formatIsoDate(new Date()));
  const [notes, setNotes] = useState(schedule.session_notes || '');
  const [rows, setRows] = useState<DraftAttendanceRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    gatewayFetch(
      `/api/class-rosters?className=${encodeURIComponent(schedule.class_name)}`,
      { cache: 'no-store' }
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat daftar siswa kelas.');
        if (!active) return;
        const students: ClassStudentRow[] = data.students || [];
        setRows(
          students.map((st) => ({
            studentId: st.id,
            studentCode: st.studentCode,
            studentName: st.fullName,
            status: 'Hadir',
            booksRead: 1,
            note: '',
          }))
        );
        setLoadError(null);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Gagal memuat daftar siswa.');
      })
      .finally(() => {
        if (active) setLoadingRoster(false);
      });

    return () => {
      active = false;
    };
  }, [schedule.class_name]);

  const liveSummary = useMemo(() => summarizeSessionAttendance(rows), [rows]);

  function updateRowStatus(studentId: number | string, nextStatus: AttendanceStatus) {
    setRows((prev) =>
      prev.map((row) => {
        if (String(row.studentId) !== String(studentId)) return row;
        return {
          ...row,
          status: nextStatus,
          booksRead: nextStatus === 'Hadir' ? Math.max(1, row.booksRead) : 0,
        };
      })
    );
  }

  function updateRowBooks(studentId: number | string, val: string) {
    const parsed = Math.max(0, Math.min(20, Number(val) || 0));
    setRows((prev) =>
      prev.map((row) =>
        String(row.studentId) === String(studentId) ? { ...row, booksRead: parsed } : row
      )
    );
  }

  function updateRowNote(studentId: number | string, note: string) {
    setRows((prev) =>
      prev.map((row) =>
        String(row.studentId) === String(studentId) ? { ...row, note } : row
      )
    );
  }

  function handleMarkAllPresent() {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        status: 'Hadir',
        booksRead: Math.max(1, row.booksRead),
        note: '',
      }))
    );
  }

  function handleSetOneBookEach() {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        booksRead: row.status === 'Hadir' ? 1 : 0,
      }))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload =
        rows.length > 0
          ? {
              action: 'log_session',
              status,
              sessionDate,
              notes: notes.trim(),
              attendance: rows.map((r) => ({
                studentId: r.studentId,
                status: r.status,
                booksRead: r.status === 'Hadir' ? r.booksRead : 0,
                note: r.note.trim(),
              })),
            }
          : {
              action: 'log_session',
              status,
              sessionDate,
              studentsPresent: schedule.student_count,
              booksReadCount: schedule.student_count,
              notes: notes.trim(),
            };

      const res = await gatewayFetch(`/api/reading-schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat pelaksanaan & absensi sesi.');

      showToast(
        'success',
        'Sesi & absensi siswa tersimpan',
        `${schedule.class_name}: ${liveSummary.presentCount} hadir, ${liveSummary.absentCount} tidak hadir (${liveSummary.totalBooksRead} buku)`
      );
      await onSaved();
      onClose();
    } catch (err) {
      showToast(
        'error',
        'Gagal mencatat absensi',
        err instanceof Error ? err.message : 'Terjadi kesalahan.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Catat Sesi & Absensi · ${schedule.class_name}`}
      description={`${schedule.day_of_week} ${schedule.start_time}–${schedule.end_time} WIB · ${schedule.room_area}`}
      maxWidth="max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Class Teacher Info Banner */}
        <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE] p-3 text-xs sm:grid-cols-2">
          <div className="flex items-center gap-2 text-[#1E2433]">
            <GraduationCap className="h-4 w-4 shrink-0 text-[#222B3A]" />
            <span>
              <strong className="text-[#5C5E64] font-medium">Wali Kelas:</strong>{' '}
              {schedule.homeroom_teacher}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[#1E2433]">
            <UserCheck className="h-4 w-4 shrink-0 text-[#E56B63]" />
            <span>
              <strong className="text-[#5C5E64] font-medium">Pendamping:</strong>{' '}
              {schedule.companion_teacher || '-'}
            </span>
          </div>
        </div>

        {/* Session Meta Inputs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SelectField
            label="Status Pelaksanaan"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="Selesai">Selesai</option>
            <option value="Berlangsung">Berlangsung</option>
            <option value="Ditunda">Ditunda</option>
          </SelectField>
          <TextField
            label="Tanggal Pelaksanaan"
            type="date"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            required
          />
          <TextField
            label="Catatan Sesi"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ringkasan kegiatan baca kelas"
          />
        </div>

        {/* Live Attendance Summary Strip + Quick Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
              <Users className="h-3.5 w-3.5" />
              Hadir: {liveSummary.presentCount}/{liveSummary.totalStudents} ({liveSummary.attendanceRate}%)
            </span>
            <span className="text-amber-700">Izin: {liveSummary.izinCount}</span>
            <span className="text-sky-700">Sakit: {liveSummary.sakitCount}</span>
            <span className="text-[#C94A43]">Alpa: {liveSummary.alpaCount}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-[#E56B63]">
              <BookOpen className="h-3.5 w-3.5" />
              Buku: {liveSummary.totalBooksRead}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="secondary" onClick={handleMarkAllPresent}>
              <CheckCheck className="h-3.5 w-3.5 text-emerald-700" />
              Hadir Semua
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={handleSetOneBookEach}>
              1 Buku/Hadir
            </Button>
          </div>
        </div>

        {/* Per-Student Attendance Checklist */}
        {loadingRoster && <LoadingState rows={5} />}
        {loadError && <ErrorState message={loadError} />}

        {!loadingRoster && !loadError && rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-white">
            <div className="max-h-[42vh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] font-medium text-[#5C5E64]">
                  <tr>
                    <th className="px-3 py-2.5 w-9 text-center">No</th>
                    <th className="px-3 py-2.5">Siswa</th>
                    <th className="px-3 py-2.5">Status Kehadiran</th>
                    <th className="px-3 py-2.5 w-20 text-center">Buku</th>
                    <th className="px-3 py-2.5">Keterangan (alasan / catatan)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {rows.map((row, idx) => {
                    const isPresent = row.status === 'Hadir';
                    return (
                      <tr
                        key={row.studentId}
                        className={cn(
                          'transition-colors',
                          !isPresent ? 'bg-[#FDF6F5]/70' : 'hover:bg-[#FAF9F5]'
                        )}
                      >
                        <td className="px-3 py-2 text-center font-mono text-[#7B7D82] tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-[#1E2433]">{row.studentName}</p>
                          <p className="font-mono text-[10px] text-[#7B7D82]">{row.studentCode}</p>
                        </td>
                        <td className="px-3 py-2">
                          <div
                            className="inline-flex flex-wrap items-center gap-1"
                            role="group"
                            aria-label={`Kehadiran ${row.studentName}`}
                          >
                            {ATTENDANCE_STATUSES.map((stOpt) => {
                              const active = row.status === stOpt;
                              return (
                                <button
                                  key={stOpt}
                                  type="button"
                                  onClick={() => updateRowStatus(row.studentId, stOpt)}
                                  className={cn(
                                    'rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                                    active
                                      ? STATUS_BUTTON_STYLES[stOpt].active
                                      : STATUS_BUTTON_STYLES[stOpt].idle
                                  )}
                                >
                                  {stOpt}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            disabled={!isPresent}
                            aria-label={`Jumlah buku dibaca ${row.studentName}`}
                            value={isPresent ? row.booksRead : 0}
                            onChange={(e) => updateRowBooks(row.studentId, e.target.value)}
                            className="h-8 w-16 rounded-lg border border-[#E2DFD7] bg-white px-2 text-center font-mono text-xs tabular-nums text-[#1E2433] disabled:bg-[#F4F3EE] disabled:text-[#8A8B90]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            aria-label={`Keterangan absensi ${row.studentName}`}
                            value={row.note}
                            onChange={(e) => updateRowNote(row.studentId, e.target.value)}
                            placeholder={
                              isPresent ? 'Opsional' : 'Misal: Demam / izin keluarga'
                            }
                            className="h-8 w-full min-w-[140px] rounded-lg border border-[#E2DFD7] bg-white px-2.5 text-xs text-[#1E2433] placeholder:text-[#9A9B9F] focus:border-[#222B3A] focus:outline-none"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E4DC] pt-4">
          <p className="text-xs text-[#5C5E64]">
            {liveSummary.absentCount > 0 ? (
              <span>
                Tidak hadir ({liveSummary.absentCount}):{' '}
                <strong className="text-[#9E352F]">
                  {liveSummary.absentStudents.map((a) => `${a.studentName} (${a.status})`).join(', ')}
                </strong>
              </span>
            ) : (
              <span className="text-emerald-800 font-medium">
                Semua siswa hadir pada sesi baca ini.
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" loading={saving} disabled={loadingRoster}>
              <CheckCircle2 className="h-4 w-4" />
              Simpan Sesi &amp; Absensi
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
