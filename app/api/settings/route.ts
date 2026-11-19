import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/crypto';
import { logAudit } from '@/lib/db/audit';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';
import {
  DEFAULT_SYSTEM_SETTINGS,
  SYSTEM_ROLE_SLUGS,
  evaluateBackupHealth,
  extractCirculationPolicy,
  guardSuperAdminLockout,
  parseNumberSetting,
  validateCustomRoleInput,
  validateMembershipPolicyInput,
  validatePasswordStrength,
} from '@/lib/domain/settings-backup-rules';

export async function GET() {
  const { errorResponse } = await requirePermission('settings.read');
  if (errorResponse) return errorResponse;
  const db = getDb();

  const settingsRows = db.prepare('SELECT key, value FROM library_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const settings: Record<string, string> = { ...DEFAULT_SYSTEM_SETTINGS };
  for (const r of settingsRows) settings[r.key] = r.value;
  if (!settingsRows.some((r) => r.key === 'operational_hours') && settings.operating_hours) {
    settings.operational_hours = settings.operating_hours;
  }
  if (!settingsRows.some((r) => r.key === 'reservation_expiry_days') && settings.reservation_pickup_hours) {
    settings.reservation_expiry_days = String(
      Math.max(1, Math.ceil(parseNumberSetting(settings.reservation_pickup_hours, 72, 24) / 24))
    );
  }

  const membershipTypes = db
    .prepare(
      `SELECT mt.*,
         (SELECT COUNT(*) FROM members m WHERE m.membership_type_id = mt.id AND m.archived_at IS NULL) as member_count
       FROM membership_types mt
       ORDER BY mt.id ASC`
    )
    .all();

  const roles = db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) as user_count,
         (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) as permission_count
       FROM roles r
       ORDER BY r.id ASC`
    )
    .all();

  const permissions = db
    .prepare('SELECT * FROM permissions ORDER BY module ASC, code ASC')
    .all();

  const rolePermissions = db
    .prepare('SELECT role_id, permission_id FROM role_permissions')
    .all();

  const users = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.role_id, u.created_at, u.updated_at,
              r.name as role_name, r.slug as role_slug
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
    )
    .all();

  const auditLogs = db
    .prepare(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, before_json, after_json, ip_address, created_at
       FROM audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT 300`
    )
    .all();

  const latestSnap = db
    .prepare('SELECT created_at FROM backup_snapshots ORDER BY created_at DESC, id DESC LIMIT 1')
    .get() as { created_at?: string } | undefined;

  const snapshotCountRow = db
    .prepare('SELECT COUNT(*) as c FROM backup_snapshots')
    .get() as { c: number };

  const backupHealth = evaluateBackupHealth(
    latestSnap?.created_at || null,
    settings.backup_auto_frequency || 'weekly'
  );

  return NextResponse.json({
    settings,
    membershipTypes,
    roles,
    permissions,
    rolePermissions,
    users,
    auditLogs,
    backupSummary: {
      snapshotCount: snapshotCountRow.c,
      lastSnapshotAt: latestSnap?.created_at || null,
      health: backupHealth,
    },
  });
}

export async function PUT(req: NextRequest) {
  const { user: auth, errorResponse } = await requirePermission('settings.write');
  if (errorResponse) return errorResponse;
  const db = getDb();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Format JSON tidak valid.' }, { status: 400 });
  }

  const section = String(body.section || '');

  // 1. Update general & backup policy settings
  if (section === 'general') {
    const updates = (body.settings || {}) as Record<string, unknown>;
    const allowedKeys = new Set(Object.keys(DEFAULT_SYSTEM_SETTINGS));
    const entries = Object.entries(updates).filter(([k]) => allowedKeys.has(k));

    if (entries.length === 0) {
      return NextResponse.json({ error: 'Tidak ada pengaturan valid yang dikirim.' }, { status: 400 });
    }

    const beforeRows = db.prepare('SELECT key, value FROM library_settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const beforeMap: Record<string, string> = {};
    for (const r of beforeRows) beforeMap[r.key] = r.value;

    const afterMap: Record<string, string> = {};
    db.transaction(() => {
      const stmt = db.prepare(
        `INSERT INTO library_settings (key, value, updated_at, updated_by_user_id)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by_user_id = excluded.updated_by_user_id`
      );
      for (const [k, v] of entries) {
        const cleanVal = String(v ?? '').trim().slice(0, 500);
        stmt.run(k, cleanVal, auth.id);
        afterMap[k] = cleanVal;

        // Keep legacy alias keys in sync so all readers see identical values
        if (k === 'operational_hours') {
          stmt.run('operating_hours', cleanVal, auth.id);
          afterMap.operating_hours = cleanVal;
        } else if (k === 'reservation_expiry_days') {
          const days = Math.max(1, parseNumberSetting(cleanVal, 3, 1, 30));
          const hoursStr = String(days * 24);
          stmt.run('reservation_pickup_hours', hoursStr, auth.id);
          afterMap.reservation_pickup_hours = hoursStr;
        } else if (k === 'auto_reminder_days_before_due') {
          stmt.run('notify_due_days_before', cleanVal, auth.id);
          afterMap.notify_due_days_before = cleanVal;
        }
      }
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'SETTINGS_UPDATE',
        entityType: 'library_settings',
        entityId: 'global',
        before: beforeMap,
        after: afterMap,
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 2. Update existing membership type policy
  if (section === 'membership_type') {
    const mt = (body.membershipType || {}) as Record<string, unknown>;
    const id = Number(mt.id || 0);
    if (!id) {
      return NextResponse.json({ error: 'ID jenis anggota tidak valid.' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM membership_types WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Jenis anggota tidak ditemukan.' }, { status: 404 });
    }

    const payload = {
      name: String(mt.name || '').trim(),
      max_loans: Number(mt.max_loans),
      loan_duration_days: Number(mt.loan_duration_days),
      max_renewals: Number(mt.max_renewals),
      daily_fine_rate: Number(mt.daily_fine_rate),
      max_fine_cap: Number(mt.max_fine_cap),
      allow_reservation: mt.allow_reservation === false || mt.allow_reservation === 0 ? 0 : 1,
    };

    const validation = validateMembershipPolicyInput(payload);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const policyMode = extractCirculationPolicy(getSettingsMap(db)).policyApplicationMode;
    const prevDuration = Number(existing.loan_duration_days || 7);

    db.transaction(() => {
      db.prepare(
        `UPDATE membership_types
         SET name = ?, max_loans = ?, loan_duration_days = ?, max_renewals = ?,
             daily_fine_rate = ?, max_fine_cap = ?, allow_reservation = ?
         WHERE id = ?`
      ).run(
        payload.name,
        payload.max_loans,
        payload.loan_duration_days,
        payload.max_renewals,
        payload.daily_fine_rate,
        payload.max_fine_cap,
        payload.allow_reservation,
        id
      );

      // When policy_application_mode === 'apply_to_active', update active non-renewed loans for this membership type
      if (policyMode === 'apply_to_active' && payload.loan_duration_days !== prevDuration) {
        const today = formatIsoDate(new Date());
        const activeLoans = db
          .prepare(
            `SELECT l.id, l.loan_date
             FROM loans l
             JOIN members m ON m.id = l.member_id
             WHERE m.membership_type_id = ?
               AND l.status IN ('Aktif', 'Terlambat', 'Sebagian Kembali')`
          )
          .all(id) as Array<{ id: number; loan_date: string }>;

        for (const loan of activeLoans) {
          const recalculatedDue = addDaysIso(loan.loan_date, payload.loan_duration_days);
          db.prepare(
            `UPDATE loan_items
             SET due_date = ?, status = CASE WHEN ? < ? THEN 'Terlambat' ELSE 'Dipinjam' END
             WHERE loan_id = ? AND returned_at IS NULL AND renewal_count = 0`
          ).run(recalculatedDue, recalculatedDue, today, loan.id);

          const summary = db
            .prepare(
              `SELECT MAX(CASE WHEN returned_at IS NULL THEN due_date END) as max_due,
                      SUM(CASE WHEN returned_at IS NULL AND due_date < ? THEN 1 ELSE 0 END) as overdue_count,
                      SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) as returned_count
               FROM loan_items WHERE loan_id = ?`
            )
            .get(today, loan.id) as {
            max_due: string | null;
            overdue_count: number;
            returned_count: number;
          };

          if (summary.max_due) {
            const nextLoanStatus =
              summary.overdue_count > 0
                ? 'Terlambat'
                : summary.returned_count > 0
                  ? 'Sebagian Kembali'
                  : 'Aktif';
            db.prepare(
              `UPDATE loans SET due_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(summary.max_due, nextLoanStatus, loan.id);
          }
        }
      }

      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'POLICY_UPDATE',
        entityType: 'membership_type',
        entityId: String(id),
        before: existing,
        after: { ...payload, policyApplicationMode: policyMode },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 3. Create new membership type policy
  if (section === 'membership_type_create') {
    const mt = (body.membershipType || {}) as Record<string, unknown>;
    const code = String(mt.code || '').trim().toUpperCase();
    const payload = {
      code,
      name: String(mt.name || '').trim(),
      max_loans: Number(mt.max_loans || 3),
      loan_duration_days: Number(mt.loan_duration_days || 7),
      max_renewals: Number(mt.max_renewals ?? 1),
      daily_fine_rate: Number(mt.daily_fine_rate ?? 500),
      max_fine_cap: Number(mt.max_fine_cap ?? 15000),
      allow_reservation: mt.allow_reservation === false || mt.allow_reservation === 0 ? 0 : 1,
    };

    const validation = validateMembershipPolicyInput(payload);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const dup = db.prepare('SELECT id FROM membership_types WHERE code = ?').get(code);
    if (dup) {
      return NextResponse.json({ error: `Kode jenis anggota '${code}' sudah terdaftar.` }, { status: 409 });
    }

    let createdId = 0;
    db.transaction(() => {
      const res = db
        .prepare(
          `INSERT INTO membership_types (code, name, max_loans, loan_duration_days, max_renewals, daily_fine_rate, max_fine_cap, allow_reservation)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          payload.code,
          payload.name,
          payload.max_loans,
          payload.loan_duration_days,
          payload.max_renewals,
          payload.daily_fine_rate,
          payload.max_fine_cap,
          payload.allow_reservation
        );
      createdId = Number(res.lastInsertRowid);
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'POLICY_CREATE',
        entityType: 'membership_type',
        entityId: String(createdId),
        after: payload,
      });
    })();
    return NextResponse.json({ ok: true, id: createdId });
  }

  // 4. Create custom RBAC role (with optional clone from existing role)
  if (section === 'create_role') {
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim().slice(0, 240);
    const cloneFromRoleId = body.cloneFromRoleId ? Number(body.cloneFromRoleId) : null;

    const validation = validateCustomRoleInput({
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      name,
      description,
    });
    if (!validation.ok || !validation.normalizedSlug) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const exists = db.prepare('SELECT id FROM roles WHERE slug = ?').get(validation.normalizedSlug);
    if (exists) {
      return NextResponse.json(
        { error: `Peran dengan slug '${validation.normalizedSlug}' sudah ada.` },
        { status: 409 }
      );
    }

    let roleId = 0;
    db.transaction(() => {
      const inserted = db
        .prepare('INSERT INTO roles (slug, name, description) VALUES (?, ?, ?)')
        .run(validation.normalizedSlug, name, description);
      roleId = Number(inserted.lastInsertRowid);

      if (cloneFromRoleId) {
        const sourcePerms = db
          .prepare('SELECT permission_id FROM role_permissions WHERE role_id = ?')
          .all(cloneFromRoleId) as Array<{ permission_id: number }>;
        const insPerm = db.prepare(
          'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
        );
        for (const sp of sourcePerms) {
          insPerm.run(roleId, sp.permission_id);
        }
      }

      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'RBAC_ROLE_CREATE',
        entityType: 'role',
        entityId: String(roleId),
        after: { slug: validation.normalizedSlug, name, description, cloneFromRoleId },
      });
    })();

    return NextResponse.json({ ok: true, id: roleId, slug: validation.normalizedSlug });
  }

  // 5. Update RBAC role metadata
  if (section === 'update_role') {
    const roleId = Number(body.roleId || 0);
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim().slice(0, 240);
    if (!roleId || name.length < 3 || name.length > 60) {
      return NextResponse.json({ error: 'ID peran dan nama peran (3–60 karakter) wajib diisi.' }, { status: 400 });
    }
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Peran tidak ditemukan.' }, { status: 404 });
    }

    db.transaction(() => {
      db.prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?').run(name, description, roleId);
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'RBAC_ROLE_UPDATE',
        entityType: 'role',
        entityId: String(roleId),
        before: { name: existing.name, description: existing.description },
        after: { name, description },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 6. Delete custom non-system role (only if 0 users assigned)
  if (section === 'delete_role') {
    const roleId = Number(body.roleId || 0);
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as
      | { id: number; slug: string; name: string }
      | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Peran tidak ditemukan.' }, { status: 404 });
    }
    if (SYSTEM_ROLE_SLUGS.has(existing.slug)) {
      return NextResponse.json(
        { error: 'Peran bawaan sistem tidak dapat dihapus demi keamanan operasional.' },
        { status: 400 }
      );
    }
    const userCount = (
      db.prepare('SELECT COUNT(*) as c FROM users WHERE role_id = ?').get(roleId) as { c: number }
    ).c;
    if (userCount > 0) {
      return NextResponse.json(
        { error: `Peran '${existing.name}' masih digunakan oleh ${userCount} akun. Pindahkan akun terlebih dahulu.` },
        { status: 409 }
      );
    }

    db.transaction(() => {
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
      db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'RBAC_ROLE_DELETE',
        entityType: 'role',
        entityId: String(roleId),
        before: existing,
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 7. Update role permissions (with Super Admin anti-lockout guard)
  if (section === 'role_permissions') {
    const roleId = Number(body.roleId || 0);
    const permIds = Array.isArray(body.permissionIds)
      ? body.permissionIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];

    const role = db.prepare('SELECT id, slug, name FROM roles WHERE id = ?').get(roleId) as
      | { id: number; slug: string; name: string }
      | undefined;
    if (!role) {
      return NextResponse.json({ error: 'Peran tidak ditemukan.' }, { status: 404 });
    }

    const allPerms = db.prepare('SELECT id, code FROM permissions').all() as Array<{
      id: number;
      code: string;
    }>;
    const permIdToCode = new Map(allPerms.map((p) => [p.id, p.code]));
    const selectedCodes = permIds.map((pid) => permIdToCode.get(pid)).filter(Boolean) as string[];

    const lockoutCheck = guardSuperAdminLockout(role.slug, selectedCodes);
    if (!lockoutCheck.ok) {
      return NextResponse.json({ error: lockoutCheck.reason }, { status: 400 });
    }

    const beforePerms = (
      db
        .prepare(
          `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
        )
        .all(roleId) as Array<{ code: string }>
    ).map((r) => r.code);

    db.transaction(() => {
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
      const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
      for (const pid of permIds) {
        if (permIdToCode.has(pid)) {
          ins.run(roleId, pid);
        }
      }
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'RBAC_UPDATE',
        entityType: 'role',
        entityId: String(roleId),
        before: { role: role.slug, permissions: beforePerms },
        after: { role: role.slug, permissions: selectedCodes },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 8. Create user account
  if (section === 'create_user') {
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.fullName || '').trim();
    const password = String(body.password || '');
    const roleId = Number(body.roleId || 3);

    if (!username || !email || !fullName) {
      return NextResponse.json({ error: 'Nama lengkap, username, dan email wajib diisi.' }, { status: 400 });
    }
    const passCheck = validatePasswordStrength(password);
    if (!passCheck.ok) {
      return NextResponse.json({ error: passCheck.reason }, { status: 400 });
    }

    const exists = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    if (exists) {
      return NextResponse.json({ error: 'Username atau email sudah terdaftar.' }, { status: 409 });
    }

    const roleExists = db.prepare('SELECT id, name FROM roles WHERE id = ?').get(roleId) as
      | { id: number; name: string }
      | undefined;
    if (!roleExists) {
      return NextResponse.json({ error: 'Peran yang dipilih tidak valid.' }, { status: 400 });
    }

    let userId = 0;
    db.transaction(() => {
      const res = db
        .prepare(
          `INSERT INTO users (username, email, full_name, password_hash, role_id, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`
        )
        .run(username, email, fullName, hashPassword(password), roleId);
      userId = Number(res.lastInsertRowid);
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'USER_CREATE',
        entityType: 'user',
        entityId: String(userId),
        after: { username, email, fullName, roleId, roleName: roleExists.name },
      });
    })();
    return NextResponse.json({ ok: true, id: userId });
  }

  // 9. Update user profile & role
  if (section === 'update_user') {
    const userId = Number(body.userId || 0);
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const roleId = Number(body.roleId || 0);

    if (!userId || !fullName || !email || !roleId) {
      return NextResponse.json({ error: 'Data pengguna dan peran wajib lengkap.' }, { status: 400 });
    }

    const target = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.full_name, u.role_id, r.slug as role_slug
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
      )
      .get(userId) as
      | { id: number; username: string; email: string; full_name: string; role_id: number; role_slug: string }
      | undefined;
    if (!target) {
      return NextResponse.json({ error: 'Akun pengguna tidak ditemukan.' }, { status: 404 });
    }

    const nextRole = db.prepare('SELECT id, slug, name FROM roles WHERE id = ?').get(roleId) as
      | { id: number; slug: string; name: string }
      | undefined;
    if (!nextRole) {
      return NextResponse.json({ error: 'Peran tujuan tidak valid.' }, { status: 400 });
    }

    if (target.id === auth.id && target.role_slug === 'super_admin' && nextRole.slug !== 'super_admin') {
      return NextResponse.json(
        { error: 'Anda tidak dapat menurunkan peran Super Admin milik akun sendiri.' },
        { status: 400 }
      );
    }

    const emailDup = db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(email, userId);
    if (emailDup) {
      return NextResponse.json({ error: 'Email sudah digunakan oleh akun lain.' }, { status: 409 });
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE users SET full_name = ?, email = ?, role_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(fullName, email, roleId, userId);
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'USER_UPDATE',
        entityType: 'user',
        entityId: String(userId),
        before: { fullName: target.full_name, email: target.email, roleId: target.role_id },
        after: { fullName, email, roleId, roleName: nextRole.name },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 10. Reset user password
  if (section === 'reset_password') {
    const userId = Number(body.userId || 0);
    const newPassword = String(body.newPassword || '');
    const passCheck = validatePasswordStrength(newPassword);
    if (!userId || !passCheck.ok) {
      return NextResponse.json({ error: passCheck.reason || 'ID pengguna tidak valid.' }, { status: 400 });
    }

    const target = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(userId) as
      | { id: number; username: string; full_name: string }
      | undefined;
    if (!target) {
      return NextResponse.json({ error: 'Akun pengguna tidak ditemukan.' }, { status: 404 });
    }

    db.transaction(() => {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
        hashPassword(newPassword),
        userId
      );
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'USER_PASSWORD_RESET',
        entityType: 'user',
        entityId: String(userId),
        after: { username: target.username, resetBy: auth.fullName },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  // 11. Toggle user active status
  if (section === 'toggle_user') {
    const userId = Number(body.userId);
    const isActive = body.isActive ? 1 : 0;
    if (userId === auth.id) {
      return NextResponse.json({ error: 'Tidak dapat menonaktifkan akun sendiri.' }, { status: 400 });
    }
    const target = db.prepare('SELECT id, username, is_active FROM users WHERE id = ?').get(userId) as
      | { id: number; username: string; is_active: number }
      | undefined;
    if (!target) {
      return NextResponse.json({ error: 'Akun pengguna tidak ditemukan.' }, { status: 404 });
    }

    db.transaction(() => {
      db.prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`).run(
        isActive,
        userId
      );
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'USER_TOGGLE',
        entityType: 'user',
        entityId: String(userId),
        before: { is_active: target.is_active },
        after: { is_active: isActive },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Section pengaturan tidak dikenal.' }, { status: 400 });
}
