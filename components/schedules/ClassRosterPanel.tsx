'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Download,
  Edit3,
  GraduationCap,
  Plus,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  SearchField,
  SelectField,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { exportToCsv, exportToExcel, exportToPdf } from '@/lib/client/export';
import { SD_CLASSES } from '@/lib/domain/reading-schedule-rules';
import { cn } from '@/lib/utils';
import type { ClassStudentRow, SchoolClassInfo, StudentRecapRow } from './types';

interface ClassRosterPanelProps {
  initialClassName?: string;
  canWrite: boolean;
  onDataChanged?: () => Promise<void> | void;
}

export function ClassRosterPanel({
  initialClassName,
  canWrite,
  onDataChanged,
}: ClassRosterPanelProps) {
  const { showToast } = useToast();
  const [selectedClass, setSelectedClass] = useState<string>(
    initialClassName && SD_CLASSES.some((c) => c.className === initialClassName)
      ? initialClassName
      : SD_CLASSES[0].className
  );
  const [classes, setClasses] = useState<SchoolClassInfo[]>([]);
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [studentRecap, setStudentRecap] = useState<StudentRecapRow[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Wali Kelas & Guru Pendamping Modal
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [editHomeroom, setEditHomeroom] = useState('');
  const [editCompanion, setEditCompanion] = useState('');
  const [syncSchedules, setSyncSchedules] = useState(true);
  const [savingTeachers, setSavingTeachers] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);

  // Add / Edit Student Modal
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<ClassStudentRow | null>(null);
  const [stName, setStName] = useState('');
  const [stCode, setStCode] = useState('');
  const [stGender, setStGender] = useState<'L' | 'P'>('L');
  const [stNotes, setStNotes] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);

  // Archive Student Confirm
  const [archiveStudentTarget, setArchiveStudentTarget] = useState<ClassStudentRow | null>(null);
  const [archivingStudent, setArchivingStudent] = useState(false);

  const loadRoster = useCallback(async (className: string) => {
    try {
      const res = await gatewayFetch(
        `/api/class-rosters?className=${encodeURIComponent(className)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data kelas dan siswa.');
      setClasses(data.classes || []);
      setStudents(data.students || []);
      setStudentRecap(data.studentRecap || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data kelas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    gatewayFetch(`/api/class-rosters?className=${encodeURIComponent(selectedClass)}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat data kelas dan siswa.');
        if (!active) return;
        setClasses(data.classes || []);
        setStudents(data.students || []);
        setStudentRecap(data.studentRecap || []);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat data kelas.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedClass]);

  const currentClassInfo = useMemo(() => {
    const found = classes.find((c) => c.className === selectedClass);
    if (found) return found;
    const preset = SD_CLASSES.find((c) => c.className === selectedClass) || SD_CLASSES[0];
    return {
      className: preset.className,
      gradeLevel: preset.gradeLevel,
      homeroomTeacher: preset.homeroomTeacher,
      companionTeacher: preset.companionTeacher,
      activeStudentCount: students.length || preset.studentCount,
    };
  }, [classes, selectedClass, students.length]);

  const recapMap = useMemo(() => {
    const map = new Map<string, StudentRecapRow>();
    for (const r of studentRecap) {
      map.set(String(r.studentId), r);
      if (r.studentCode) map.set(r.studentCode, r);
    }
    return map;
  }, [studentRecap]);

  const filteredStudents = useMemo(() => {
    const term = searchQ.trim().toLowerCase();
    if (!term) return students;
    return students.filter(
      (s) =>
        s.fullName.toLowerCase().includes(term) ||
        s.studentCode.toLowerCase().includes(term) ||
        (s.notes || '').toLowerCase().includes(term)
    );
  }, [students, searchQ]);

  const exportRows = useMemo(
    () =>
      filteredStudents.map((st, idx) => {
        const rec = recapMap.get(String(st.id)) || recapMap.get(st.studentCode);
        return {
          No: idx + 1,
          Kelas: currentClassInfo.className,
          Wali_Kelas: currentClassInfo.homeroomTeacher,
          Guru_Pendamping: currentClassInfo.companionTeacher,
          NIS: st.studentCode,
          Nama_Siswa: st.fullName,
          LP: st.gender,
          Total_Sesi: rec?.totalSessions ?? 0,
          Hadir: rec?.presentSessions ?? 0,
          Izin: rec?.izinSessions ?? 0,
          Sakit: rec?.sakitSessions ?? 0,
          Alpa: rec?.alpaSessions ?? 0,
          Persen_Hadir: rec && rec.totalSessions > 0 ? `${rec.attendanceRate}%` : '-',
          Total_Buku: rec?.totalBooksRead ?? 0,
        };
      }),
    [filteredStudents, recapMap, currentClassInfo]
  );

  function openTeacherModal() {
    setEditHomeroom(currentClassInfo.homeroomTeacher);
    setEditCompanion(currentClassInfo.companionTeacher);
    setSyncSchedules(true);
    setTeacherError(null);
    setTeacherModalOpen(true);
  }

  async function handleSaveTeachers(e: React.FormEvent) {
    e.preventDefault();
    setSavingTeachers(true);
    setTeacherError(null);
    try {
      const res = await gatewayFetch('/api/class-rosters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          className: selectedClass,
          homeroomTeacher: editHomeroom.trim(),
          companionTeacher: editCompanion.trim(),
          syncSchedules,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeacherError(data.error || 'Gagal menyimpan data wali kelas & pendamping.');
        return;
      }
      showToast(
        'success',
        'Wali kelas & pendamping diperbarui',
        `${selectedClass}: ${editHomeroom.trim()} & ${editCompanion.trim()}`
      );
      setTeacherModalOpen(false);
      await loadRoster(selectedClass);
      if (onDataChanged) await onDataChanged();
    } catch (err) {
      setTeacherError(err instanceof Error ? err.message : 'Gagal menyimpan data guru.');
    } finally {
      setSavingTeachers(false);
    }
  }

  function openAddStudentModal() {
    setEditingStudent(null);
    setStName('');
    setStCode('');
    setStGender('L');
    setStNotes('');
    setStudentError(null);
    setStudentModalOpen(true);
  }

  function openEditStudentModal(st: ClassStudentRow) {
    setEditingStudent(st);
    setStName(st.fullName);
    setStCode(st.studentCode);
    setStGender(st.gender);
    setStNotes(st.notes || '');
    setStudentError(null);
    setStudentModalOpen(true);
  }

  async function handleSaveStudent(e: React.FormEvent) {
    e.preventDefault();
    setSavingStudent(true);
    setStudentError(null);
    try {
      const isEdit = Boolean(editingStudent);
      const res = await gatewayFetch('/api/class-rosters', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? {
                action: 'update',
                id: editingStudent?.id,
                fullName: stName.trim(),
                studentCode: stCode.trim() || undefined,
                gender: stGender,
                notes: stNotes.trim(),
              }
            : {
                className: selectedClass,
                fullName: stName.trim(),
                studentCode: stCode.trim() || undefined,
                gender: stGender,
                notes: stNotes.trim(),
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setStudentError(data.error || 'Gagal menyimpan data siswa.');
        return;
      }
      showToast(
        'success',
        isEdit ? 'Data siswa diperbarui' : 'Siswa ditambahkan',
        `${stName.trim()} (${selectedClass})`
      );
      setStudentModalOpen(false);
      await loadRoster(selectedClass);
      if (onDataChanged) await onDataChanged();
    } catch (err) {
      setStudentError(err instanceof Error ? err.message : 'Gagal menyimpan data siswa.');
    } finally {
      setSavingStudent(false);
    }
  }

  async function handleConfirmArchiveStudent() {
    if (!archiveStudentTarget) return;
    setArchivingStudent(true);
    try {
      const res = await gatewayFetch('/api/class-rosters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archive',
          id: archiveStudentTarget.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengarsipkan siswa.');
      showToast(
        'success',
        'Siswa diarsipkan',
        `${archiveStudentTarget.fullName} tidak lagi aktif di ${selectedClass}.`
      );
      setArchiveStudentTarget(null);
      await loadRoster(selectedClass);
      if (onDataChanged) await onDataChanged();
    } catch (err) {
      showToast(
        'error',
        'Gagal mengarsipkan siswa',
        err instanceof Error ? err.message : 'Terjadi kesalahan.'
      );
    } finally {
      setArchivingStudent(false);
    }
  }

  const classButtons = useMemo(() => {
    if (classes.length > 0) return classes;
    return SD_CLASSES.map((c) => ({
      className: c.className,
      gradeLevel: c.gradeLevel,
      homeroomTeacher: c.homeroomTeacher,
      companionTeacher: c.companionTeacher,
      activeStudentCount: c.studentCount,
    }));
  }, [classes]);

  return (
    <div className="space-y-5">
      {/* 12-Class Selector */}
      <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-serif text-base font-semibold text-[#1E2433]">
              Daftar Kelas SD, Wali Kelas, Pendamping &amp; Data Siswa
            </h2>
            <p className="text-xs text-[#5C5E64]">
              Pilih kelas untuk melihat atau mengelola wali kelas, guru pendamping, daftar siswa, serta rekap kehadiran literasi tiap siswa.
            </p>
          </div>
          <span className="font-mono text-xs text-[#5C5E64] tabular-nums">
            {classButtons.length} kelas ·{' '}
            {classButtons.reduce((sum, c) => sum + c.activeStudentCount, 0)} siswa aktif
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12">
          {classButtons.map((cls) => {
            const isSelected = cls.className === selectedClass;
            const shortLabel = cls.className.replace('Kelas ', '');
            return (
              <button
                key={cls.className}
                type="button"
                onClick={() => {
                  setLoading(true);
                  setSelectedClass(cls.className);
                }}
                className={cn(
                  'flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer',
                  isSelected
                    ? 'border-[#222B3A] bg-[#222B3A] text-white'
                    : 'border-[#E2DFD7] bg-white hover:bg-[#EFECE3]/70 text-[#1E2433]'
                )}
              >
                <span className="font-mono text-xs font-semibold tabular-nums">{shortLabel}</span>
                <span
                  className={cn(
                    'mt-0.5 font-mono text-[11px] tabular-nums',
                    isSelected ? 'text-white/80' : 'text-[#5C5E64]'
                  )}
                >
                  {cls.activeStudentCount} siswa
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected Class Leadership Card (Wali Kelas + Pendamping) */}
      <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="font-serif text-xl font-semibold text-[#1E2433]">
                {currentClassInfo.className}
              </h3>
              <span className="rounded-full border border-[#E2DFD7] bg-[#F4F3EE] px-2.5 py-0.5 font-mono text-xs text-[#4A4945] tabular-nums">
                Tingkat {currentClassInfo.gradeLevel}
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-medium text-emerald-800 tabular-nums">
                {students.length} siswa aktif
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 rounded-xl border border-[#E7E4DC] bg-white px-3.5 py-2.5">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-[#222B3A]" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#7B7D82]">
                    Wali Kelas
                  </p>
                  <p className="text-sm font-semibold text-[#1E2433]">
                    {currentClassInfo.homeroomTeacher}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-[#E7E4DC] bg-white px-3.5 py-2.5">
                <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#E56B63]" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#7B7D82]">
                    Guru Pendamping
                  </p>
                  <p className="text-sm font-semibold text-[#1E2433]">
                    {currentClassInfo.companionTeacher}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {canWrite && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button variant="secondary" size="sm" onClick={openTeacherModal}>
                <Edit3 className="h-3.5 w-3.5" />
                Edit Wali &amp; Pendamping
              </Button>
              <Button size="sm" onClick={openAddStudentModal}>
                <Plus className="h-3.5 w-3.5" />
                Tambah Siswa
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Toolbar: Search + Export */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-3.5">
        <SearchField
          value={searchQ}
          onChange={setSearchQ}
          placeholder={`Cari nama atau NIS siswa ${selectedClass}...`}
          ariaLabel="Cari siswa dalam kelas"
          className="w-full sm:w-72"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportToCsv(`data-siswa-${selectedClass.toLowerCase().replace(/\s+/g, '-')}`, exportRows)
            }
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportToExcel(
                `data-siswa-${selectedClass.toLowerCase().replace(/\s+/g, '-')}`,
                selectedClass,
                exportRows
              )
            }
          >
            <Download className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportToPdf(
                `data-siswa-${selectedClass.toLowerCase().replace(/\s+/g, '-')}`,
                `Daftar Siswa & Rekap Kehadiran Baca — ${selectedClass}`,
                exportRows
              )
            }
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Student Roster & Cumulative Attendance Recap Table */}
      {loading && <LoadingState rows={6} />}
      {error && <ErrorState message={error} onRetry={() => loadRoster(selectedClass)} />}

      {!loading && !error && filteredStudents.length === 0 && (
        <EmptyState
          title={`Belum ada siswa pada filter ${selectedClass}`}
          description="Tambahkan data siswa atau ubah kata kunci pencarian untuk melihat daftar absensi kelas."
          action={
            canWrite ? (
              <Button onClick={openAddStudentModal}>
                <Plus className="h-4 w-4" />
                Tambah Siswa ke {selectedClass}
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading && !error && filteredStudents.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
          <div className="flex items-center justify-between border-b border-[#E7E4DC] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#222B3A]" />
              <h4 className="font-serif text-sm font-semibold text-[#1E2433]">
                Daftar Siswa &amp; Rekap Kehadiran Kumulatif ({selectedClass})
              </h4>
            </div>
            <span className="font-mono text-xs text-[#5C5E64] tabular-nums">
              Menampilkan {filteredStudents.length} siswa
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-[#5C5E64]">
                <tr>
                  <th className="px-4 py-3 text-center w-12">No</th>
                  <th className="px-4 py-3">NIS / Kode</th>
                  <th className="px-4 py-3">Nama Siswa</th>
                  <th className="px-3 py-3 text-center">L/P</th>
                  <th className="px-3 py-3 text-right">Sesi</th>
                  <th className="px-3 py-3 text-right">Hadir</th>
                  <th className="px-3 py-3 text-right">Izin</th>
                  <th className="px-3 py-3 text-right">Sakit</th>
                  <th className="px-3 py-3 text-right">Alpa</th>
                  <th className="px-3 py-3 text-right">% Hadir</th>
                  <th className="px-3 py-3 text-right">Buku</th>
                  {canWrite && <th className="no-print px-4 py-3 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE7DF]">
                {filteredStudents.map((st, idx) => {
                  const rec = recapMap.get(String(st.id)) || recapMap.get(st.studentCode);
                  const totalSesi = rec?.totalSessions ?? 0;
                  return (
                    <tr key={st.id} className="hover:bg-[#F4F3EE]/70">
                      <td className="px-4 py-3 text-center font-mono text-xs text-[#7B7D82] tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#1E2433] whitespace-nowrap">
                        {st.studentCode}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#1E2433]">{st.fullName}</p>
                        {st.notes && <p className="text-xs text-[#7B7D82]">{st.notes}</p>}
                      </td>
                      <td className="px-3 py-3 text-center font-mono text-xs text-[#4A4945]">
                        {st.gender}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#5C5E64]">
                        {totalSesi}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs font-semibold tabular-nums text-emerald-700">
                        {rec?.presentSessions ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-amber-700">
                        {rec?.izinSessions ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-sky-700">
                        {rec?.sakitSessions ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-[#C94A43]">
                        {rec?.alpaSessions ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs font-semibold tabular-nums text-[#1E2433]">
                        {totalSesi > 0 ? `${rec?.attendanceRate ?? 0}%` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs font-semibold tabular-nums text-[#E56B63]">
                        {rec?.totalBooksRead ?? 0}
                      </td>
                      {canWrite && (
                        <td className="no-print px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditStudentModal(st)}
                              aria-label={`Edit siswa ${st.fullName}`}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setArchiveStudentTarget(st)}
                              aria-label={`Arsipkan siswa ${st.fullName}`}
                            >
                              <Archive className="h-3.5 w-3.5 text-[#C94A43]" />
                              Arsip
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EDIT WALI KELAS & GURU PENDAMPING MODAL */}
      <Modal
        open={teacherModalOpen}
        onClose={() => setTeacherModalOpen(false)}
        title={`Edit Wali Kelas & Pendamping · ${selectedClass}`}
        description="Perbarui nama wali kelas dan guru pendamping literasi untuk kelas ini."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSaveTeachers} className="space-y-4">
          {teacherError && (
            <div className="rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] p-3 text-xs text-[#9E352F]">
              {teacherError}
            </div>
          )}
          <TextField
            label="Nama Wali Kelas"
            value={editHomeroom}
            onChange={(e) => setEditHomeroom(e.target.value)}
            placeholder="Misal: Ibu Sari Rahayu, S.Pd."
            required
          />
          <TextField
            label="Nama Guru Pendamping"
            value={editCompanion}
            onChange={(e) => setEditCompanion(e.target.value)}
            placeholder="Misal: Ibu Laila Nurul, S.Pd."
            required
          />
          <label className="flex items-start gap-2.5 rounded-xl border border-[#E7E4DC] bg-white p-3 text-xs text-[#4A4945] cursor-pointer">
            <input
              type="checkbox"
              checked={syncSchedules}
              onChange={(e) => setSyncSchedules(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#222B3A]"
            />
            <span>
              Sinkronkan otomatis nama wali kelas dan guru pendamping ke seluruh jadwal baca aktif milik{' '}
              <strong>{selectedClass}</strong>.
            </span>
          </label>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setTeacherModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={savingTeachers}>
              Simpan Data Guru
            </Button>
          </div>
        </form>
      </Modal>

      {/* ADD / EDIT STUDENT MODAL */}
      <Modal
        open={studentModalOpen}
        onClose={() => setStudentModalOpen(false)}
        title={
          editingStudent
            ? `Edit Data Siswa · ${editingStudent.fullName}`
            : `Tambah Siswa Baru · ${selectedClass}`
        }
        description="Data siswa terhubung otomatis ke daftar absensi setiap sesi baca kelas ini."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSaveStudent} className="space-y-4">
          {studentError && (
            <div className="rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] p-3 text-xs text-[#9E352F]">
              {studentError}
            </div>
          )}
          <TextField
            label="Nama Lengkap Siswa"
            value={stName}
            onChange={(e) => setStName(e.target.value)}
            placeholder="Misal: Naufal Pratama"
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="NIS / Kode Siswa (opsional)"
              value={stCode}
              onChange={(e) => setStCode(e.target.value)}
              placeholder="Otomatis jika dikosongkan"
            />
            <SelectField
              label="Jenis Kelamin"
              value={stGender}
              onChange={(e) => setStGender(e.target.value === 'P' ? 'P' : 'L')}
            >
              <option value="L">Laki-laki (L)</option>
              <option value="P">Perempuan (P)</option>
            </SelectField>
          </div>
          <TextField
            label="Catatan Siswa (opsional)"
            value={stNotes}
            onChange={(e) => setStNotes(e.target.value)}
            placeholder="Misal: Koordinator pojok baca kelas"
          />
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setStudentModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={savingStudent}>
              {editingStudent ? 'Simpan Perubahan' : 'Tambahkan Siswa'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ARCHIVE STUDENT CONFIRM */}
      <ConfirmDialog
        open={Boolean(archiveStudentTarget)}
        onClose={() => setArchiveStudentTarget(null)}
        onConfirm={handleConfirmArchiveStudent}
        title="Arsipkan Data Siswa?"
        message={`Siswa ${archiveStudentTarget?.fullName} (${archiveStudentTarget?.studentCode}) akan diarsipkan dari daftar aktif ${selectedClass}. Riwayat absensi sesi sebelumnya tetap tersimpan.`}
        confirmLabel="Arsipkan Siswa"
        loading={archivingStudent}
      />
    </div>
  );
}
