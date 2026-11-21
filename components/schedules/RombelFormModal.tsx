'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2, RotateCcw, Users } from 'lucide-react';
import { Button, Modal, TextField } from '@/components/ui/DesignPrimitives';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import {
  normalizeRombelName,
  parseBulkStudentLines,
  parseRombelParts,
  suggestNextSectionForGrade,
} from '@/lib/domain/reading-schedule-rules';
import { cn } from '@/lib/utils';

export interface RombelCreatedResult {
  className: string;
  gradeLevel: number;
  createdStudentsCount: number;
  createdScheduleCode: string | null;
}

interface RombelFormModalProps {
  open: boolean;
  onClose: () => void;
  existingClassNames: string[];
  onCreated: (result: RombelCreatedResult) => Promise<void> | void;
}

const GRADE_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const QUICK_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export function RombelFormModal(props: RombelFormModalProps) {
  if (!props.open) return null;
  return <RombelFormModalInner {...props} />;
}

function RombelFormModalInner({
  open,
  onClose,
  existingClassNames,
  onCreated,
}: RombelFormModalProps) {
  const { showToast } = useToast();
  const [gradeLevel, setGradeLevel] = useState<number>(6);
  const [section, setSection] = useState<string>(() =>
    suggestNextSectionForGrade(6, existingClassNames)
  );
  const [homeroomTeacher, setHomeroomTeacher] = useState('');
  const [companionTeacher, setCompanionTeacher] = useState('');
  const [roomLabel, setRoomLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [autoCreateSchedule, setAutoCreateSchedule] = useState(true);
  const [initialStudentsText, setInitialStudentsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivedConflictClass, setArchivedConflictClass] = useState<string | null>(null);

  const usedSectionsInGrade = useMemo(() => {
    const used = new Set<string>();
    for (const name of existingClassNames) {
      const parts = parseRombelParts(name);
      if (parts && parts.gradeLevel === gradeLevel) {
        used.add(parts.section.toUpperCase());
      }
    }
    return used;
  }, [existingClassNames, gradeLevel]);

  const previewClassName = useMemo(() => {
    const clean = section.trim();
    if (!clean) return `Kelas ${gradeLevel}?`;
    return normalizeRombelName(gradeLevel, clean);
  }, [gradeLevel, section]);

  const isDuplicateActive = useMemo(() => {
    if (!section.trim()) return false;
    return existingClassNames.some(
      (name) => name.trim().toLowerCase() === previewClassName.toLowerCase()
    );
  }, [existingClassNames, previewClassName, section]);

  const parsedInitialStudents = useMemo(
    () => parseBulkStudentLines(initialStudentsText),
    [initialStudentsText]
  );

  function handleSelectGrade(grade: number) {
    setGradeLevel(grade);
    setSection(suggestNextSectionForGrade(grade, existingClassNames));
    setError(null);
    setArchivedConflictClass(null);
  }

  async function handleRestoreArchived() {
    if (!archivedConflictClass) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/class-rosters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore_class',
          className: archivedConflictClass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal memulihkan rombel.');
        return;
      }
      showToast(
        'success',
        'Rombel dipulihkan',
        `${archivedConflictClass} kembali aktif dan tersinkronisasi.`
      );
      await onCreated({
        className: archivedConflictClass,
        gradeLevel,
        createdStudentsCount: 0,
        createdScheduleCode: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulihkan rombel.');
    } finally {
      setRestoring(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setArchivedConflictClass(null);

    if (isDuplicateActive) {
      setError(`Rombel "${previewClassName}" sudah terdaftar di sistem.`);
      return;
    }

    setSaving(true);
    try {
      const res = await gatewayFetch('/api/class-rosters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_class',
          gradeLevel,
          section: section.trim(),
          homeroomTeacher: homeroomTeacher.trim(),
          companionTeacher: companionTeacher.trim(),
          roomLabel: roomLabel.trim(),
          notes: notes.trim(),
          autoCreateSchedule,
          initialStudentsText: initialStudentsText.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.archivedExists && data.className) {
          setArchivedConflictClass(String(data.className));
        }
        setError(data.error || 'Gagal menambahkan rombel kelas baru.');
        return;
      }

      const summaryParts: string[] = [];
      if (data.createdStudentsCount > 0) {
        summaryParts.push(`${data.createdStudentsCount} siswa awal`);
      }
      if (data.createdScheduleCode) {
        summaryParts.push(`jadwal otomatis ${data.createdScheduleCode}`);
      }
      showToast(
        'success',
        `Rombel ${data.className} ditambahkan`,
        summaryParts.length > 0
          ? `Tersinkronisasi ke seluruh sistem dengan ${summaryParts.join(' & ')}.`
          : 'Langsung tersinkronisasi ke jadwal baca, absensi, keanggotaan, dan laporan.'
      );
      await onCreated({
        className: data.className,
        gradeLevel: data.gradeLevel,
        createdStudentsCount: Number(data.createdStudentsCount || 0),
        createdScheduleCode: data.createdScheduleCode || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan rombel kelas baru.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Rombel Kelas Baru"
      description="Tambahkan rombongan belajar baru (misal: Kelas 6D, 5C, atau 6 Unggulan). Otomatis tersinkronisasi ke Jadwal Baca, Absensi, Grafik, Keanggotaan, dan Laporan."
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] p-3 text-xs text-[#9E352F]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#C94A43]" />
              <span>{error}</span>
            </div>
            {archivedConflictClass && (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={restoring}
                  onClick={handleRestoreArchived}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Pulihkan {archivedConflictClass}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Grade Level & Section Selector */}
        <div className="rounded-xl border border-[#E7E4DC] bg-white p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#5C5E64]">
              Identitas Rombel
            </span>
            <span
              data-testid="rombel-preview-badge"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold tabular-nums',
                isDuplicateActive
                  ? 'border-[#F2C6C3] bg-[#FDF2F1] text-[#9E352F]'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {previewClassName} · Tingkat {gradeLevel}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#4A4945]">
              Pilih Tingkat Kelas SD
            </label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {GRADE_LEVELS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => handleSelectGrade(g)}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 font-mono text-xs font-semibold transition-colors cursor-pointer tabular-nums',
                    gradeLevel === g
                      ? 'border-[#222B3A] bg-[#222B3A] text-white'
                      : 'border-[#E2DFD7] bg-[#FAF9F5] text-[#1E2433] hover:bg-[#EFECE3]'
                  )}
                >
                  Kelas {g}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#4A4945]">
                Pilih Cepat Huruf Rombel
              </label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_SECTIONS.map((sec) => {
                  const taken = usedSectionsInGrade.has(sec);
                  const active = section.trim().toUpperCase() === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      disabled={taken}
                      onClick={() => {
                        setSection(sec);
                        setError(null);
                      }}
                      title={
                        taken
                          ? `Kelas ${gradeLevel}${sec} sudah terdaftar`
                          : `Pilih Kelas ${gradeLevel}${sec}`
                      }
                      className={cn(
                        'h-9 min-w-[40px] rounded-lg border px-2.5 font-mono text-xs font-semibold transition-colors',
                        taken
                          ? 'border-[#EAE7DF] bg-[#F4F3EE] text-[#A2A4A8] line-through cursor-not-allowed'
                          : active
                            ? 'border-[#E56B63] bg-[#E56B63] text-white cursor-pointer'
                            : 'border-[#E2DFD7] bg-white text-[#1E2433] hover:border-[#222B3A] cursor-pointer'
                      )}
                    >
                      {gradeLevel}
                      {sec}
                    </button>
                  );
                })}
              </div>
            </div>

            <TextField
              label="Huruf / Nama Rombel Kustom"
              value={section}
              onChange={(e) => {
                setSection(e.target.value);
                setError(null);
                setArchivedConflictClass(null);
              }}
              placeholder="Misal: D, E, atau Unggulan"
              maxLength={15}
              required
            />
          </div>
        </div>

        {/* Teachers & Room */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Nama Wali Kelas"
            value={homeroomTeacher}
            onChange={(e) => setHomeroomTeacher(e.target.value)}
            placeholder="Misal: Ibu Kartika Dewi, S.Pd."
            required
          />
          <TextField
            label="Nama Guru Pendamping"
            value={companionTeacher}
            onChange={(e) => setCompanionTeacher(e.target.value)}
            placeholder="Misal: Pak Dimas Prakoso, S.Pd."
            required
          />
          <TextField
            label="Ruang Kelas (opsional)"
            value={roomLabel}
            onChange={(e) => setRoomLabel(e.target.value)}
            placeholder="Misal: Gedung B Lt. 2"
            maxLength={60}
          />
          <TextField
            label="Catatan Rombel (opsional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Misal: Rombel tambahan TA 2026/2027"
            maxLength={240}
          />
        </div>

        {/* Auto-schedule option */}
        <label className="flex items-start gap-2.5 rounded-xl border border-[#E7E4DC] bg-white p-3.5 text-xs text-[#4A4945] cursor-pointer">
          <input
            type="checkbox"
            checked={autoCreateSchedule}
            onChange={(e) => setAutoCreateSchedule(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#222B3A]"
          />
          <span className="space-y-0.5">
            <span className="flex items-center gap-1.5 font-semibold text-[#1E2433]">
              <CalendarPlus className="h-3.5 w-3.5 text-[#E56B63]" />
              Langsung buatkan slot jadwal baca mingguan otomatis
            </span>
            <span className="block text-[11px] text-[#5C5E64]">
              Sistem otomatis memilihkan hari, jam, dan pojok baca yang bebas bentrok untuk{' '}
              <strong>{previewClassName}</strong>.
            </span>
          </span>
        </label>

        {/* Optional Bulk Initial Students */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="rombel-initial-students"
              className="flex items-center gap-1.5 text-xs font-medium text-[#4A4945]"
            >
              <Users className="h-3.5 w-3.5 text-[#222B3A]" />
              Daftar Siswa Awal (opsional, 1 nama per baris)
            </label>
            {parsedInitialStudents.length > 0 && (
              <span className="font-mono text-[11px] font-semibold text-emerald-700 tabular-nums">
                {parsedInitialStudents.length} siswa siap ditambahkan
              </span>
            )}
          </div>
          <textarea
            id="rombel-initial-students"
            rows={3}
            value={initialStudentsText}
            onChange={(e) => setInitialStudentsText(e.target.value)}
            placeholder={`Kosongkan jika ingin menambah siswa nanti. Format per baris:\nNadia Putri, P\nRaka Pratama, L\nNIS-6D-03 | Bunga Melati | P`}
            className="w-full rounded-xl border border-[#E2DFD7] bg-white px-3.5 py-2.5 text-xs text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={saving} disabled={isDuplicateActive}>
            Simpan Rombel {section.trim() ? previewClassName : ''}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
