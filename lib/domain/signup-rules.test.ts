import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnitOrClassLabel,
  canApproverAssignRole,
  canRoleApproveRegistrations,
  detectClassTeacherConflict,
  detectLibraryLeadershipConflict,
  getRoleSignupConfig,
  isPlaceholderTeacherName,
  resolveMembershipTypeCodeForSignup,
  validateRoleSpecificSignupFields,
} from './signup-rules';

describe('signup-rules pure domain logic', () => {
  const activeClasses = ['Kelas 1A', 'Kelas 1B', 'Kelas 4A', 'Kelas 6B'];

  it('detects placeholder vs real teacher names accurately', () => {
    assert.equal(isPlaceholderTeacherName(''), true);
    assert.equal(isPlaceholderTeacherName('  -  '), true);
    assert.equal(isPlaceholderTeacherName('Belum diisi'), true);
    assert.equal(isPlaceholderTeacherName('Belum ditentukan'), true);
    assert.equal(isPlaceholderTeacherName('Ibu Sari Rahayu, S.Pd.'), false);
  });

  it('enforces class dropdown and gender for siswa', () => {
    const missingClass = validateRoleSpecificSignupFields(
      { roleSlug: 'siswa', fullName: 'Budi Santoso', assignedClass: '', gender: 'L' },
      activeClasses
    );
    assert.equal(missingClass.valid, false);
    assert.match(missingClass.error || '', /Pilih Kelas/);

    const invalidClass = validateRoleSpecificSignupFields(
      { roleSlug: 'siswa', fullName: 'Budi Santoso', assignedClass: 'Kelas 9Z', gender: 'L' },
      activeClasses
    );
    assert.equal(invalidClass.valid, false);

    const validSiswa = validateRoleSpecificSignupFields(
      { roleSlug: 'siswa', fullName: 'Budi Santoso', assignedClass: 'Kelas 1A', gender: 'L', identityNumber: '202601099' },
      activeClasses
    );
    assert.equal(validSiswa.valid, true);
    assert.equal(validSiswa.normalizedClass, 'Kelas 1A');
    assert.equal(validSiswa.normalizedUnitOrClass, 'Kelas 1A');
  });

  it('maps siswa grade level to SISWA_RENDAH (1-3) and SISWA_TINGGI (4-6)', () => {
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'siswa', assignedClass: 'Kelas 1A' }),
      'SISWA_RENDAH'
    );
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'siswa', assignedClass: 'Kelas 3B' }),
      'SISWA_RENDAH'
    );
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'siswa', assignedClass: 'Kelas 4A' }),
      'SISWA_TINGGI'
    );
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'duta_literasi', assignedClass: 'Kelas 6B' }),
      'SISWA_TINGGI'
    );
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'wali_kelas', assignedClass: 'Kelas 1A' }),
      'GURU'
    );
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'komite_sekolah' }),
      'KOMITE'
    );
    assert.equal(
      resolveMembershipTypeCodeForSignup({ roleSlug: 'pengunjung' }),
      null
    );
  });

  it('allows direct sync when wali_kelas / guru_pendamping slot is empty and detects conflict when occupied', () => {
    const emptyHomeroom = detectClassTeacherConflict({
      roleSlug: 'wali_kelas',
      selectedClass: 'Kelas 1B',
      applicantFullName: 'Ibu Rina Kusuma, S.Pd.',
      classRecord: { className: 'Kelas 1B', homeroomTeacher: '-', companionTeacher: 'Pak Andi' },
    });
    assert.equal(emptyHomeroom.hasConflict, false);
    assert.equal(emptyHomeroom.slot, 'homeroom');

    const occupiedHomeroom = detectClassTeacherConflict({
      roleSlug: 'wali_kelas',
      selectedClass: 'Kelas 1A',
      applicantFullName: 'Pak Budi Baru, S.Pd.',
      classRecord: {
        className: 'Kelas 1A',
        homeroomTeacher: 'Ibu Sari Rahayu, S.Pd.',
        companionTeacher: '-',
      },
    });
    assert.equal(occupiedHomeroom.hasConflict, true);
    assert.equal(occupiedHomeroom.conflictType, 'class_homeroom_teacher');
    assert.equal(occupiedHomeroom.existingValue, 'Ibu Sari Rahayu, S.Pd.');

    const occupiedCompanion = detectClassTeacherConflict({
      roleSlug: 'guru_pendamping',
      selectedClass: 'Kelas 1B',
      applicantFullName: 'Ibu Dewi Pendamping',
      classRecord: { className: 'Kelas 1B', homeroomTeacher: '-', companionTeacher: 'Pak Andi' },
    });
    assert.equal(occupiedCompanion.hasConflict, true);
    assert.equal(occupiedCompanion.conflictType, 'class_companion_teacher');
    assert.equal(occupiedCompanion.slot, 'companion');
  });

  it('detects leadership kop surat conflicts for kepala_sekolah and kepala_perpustakaan', () => {
    const conflict = detectLibraryLeadershipConflict({
      roleSlug: 'kepala_sekolah',
      applicantFullName: 'Drs. Wahyu Baru, M.Pd.',
      principalName: 'Hj. Kartini Wijaya, M.Pd.',
      librarianHeadName: 'Dra. Endang Suryani',
    });
    assert.equal(conflict.hasConflict, true);
    assert.equal(conflict.conflictType, 'library_leadership');
    assert.equal(conflict.existingValue, 'Hj. Kartini Wijaya, M.Pd.');

    const sameName = detectLibraryLeadershipConflict({
      roleSlug: 'kepala_sekolah',
      applicantFullName: 'Hj. Kartini Wijaya, M.Pd.',
      principalName: 'Hj. Kartini Wijaya, M.Pd.',
    });
    assert.equal(sameName.hasConflict, false);
  });

  it('validates role-adapted required fields for other roles', () => {
    const guruMapelMissing = validateRoleSpecificSignupFields(
      { roleSlug: 'guru_mapel', fullName: 'Pak Dani', extraMeta: {} },
      activeClasses
    );
    assert.equal(guruMapelMissing.valid, false);

    const guruMapelOk = validateRoleSpecificSignupFields(
      { roleSlug: 'guru_mapel', fullName: 'Pak Dani', extraMeta: { subjectName: 'Matematika' } },
      activeClasses
    );
    assert.equal(guruMapelOk.valid, true);
    assert.equal(guruMapelOk.normalizedUnitOrClass, 'Guru Matematika');

    const kepsekNoNip = validateRoleSpecificSignupFields(
      { roleSlug: 'kepala_sekolah', fullName: 'Drs. Ahmad', identityNumber: '' },
      activeClasses
    );
    assert.equal(kepsekNoNip.valid, false);

    const komiteOptionalClass = validateRoleSpecificSignupFields(
      {
        roleSlug: 'komite_sekolah',
        fullName: 'Ibu Maya',
        assignedClass: 'Kelas 4A',
        extraMeta: { committeeRelation: 'Orang Tua / Wali Murid', childName: 'Nadia' },
      },
      activeClasses
    );
    assert.equal(komiteOptionalClass.valid, true);
    assert.equal(
      buildUnitOrClassLabel('komite_sekolah', 'Kelas 4A', komiteOptionalClass.normalizedExtraMeta),
      'Orang Tua / Wali Murid · Ortu Kelas 4A · Nadia'
    );
  });

  it('enforces approver RBAC so super_admin, admin_perpus, and kepala_perpustakaan can approve, while blocking privilege escalation', () => {
    assert.equal(canRoleApproveRegistrations('super_admin'), true);
    assert.equal(canRoleApproveRegistrations('admin_perpus'), true);
    assert.equal(canRoleApproveRegistrations('kepala_perpustakaan'), true);
    assert.equal(canRoleApproveRegistrations('pustakawan'), false);
    assert.equal(canRoleApproveRegistrations('wali_kelas'), false);

    assert.equal(canApproverAssignRole('super_admin', 'super_admin'), true);
    assert.equal(canApproverAssignRole('admin_perpus', 'wali_kelas'), true);
    assert.equal(canApproverAssignRole('kepala_perpustakaan', 'guru_pendamping'), true);
    assert.equal(canApproverAssignRole('admin_perpus', 'super_admin'), false);
    assert.equal(canApproverAssignRole('kepala_perpustakaan', 'super_admin'), false);
  });

  it('provides config for all key school roles', () => {
    const roles = [
      'siswa',
      'duta_literasi',
      'wali_kelas',
      'guru_pendamping',
      'guru_mapel',
      'guru_bk',
      'komite_sekolah',
      'anggota',
      'pengunjung',
      'petugas_kebersihan_keamanan',
      'kepala_sekolah',
      'wakil_kepala_sekolah',
      'kepala_perpustakaan',
      'admin_perpus',
      'pustakawan',
      'staff_tu',
      'bendahara_sekolah',
      'operator_it',
    ];
    for (const r of roles) {
      const cfg = getRoleSignupConfig(r);
      assert.equal(cfg.slug, r);
      assert.ok(cfg.summaryHint.length > 10);
    }
  });
});
