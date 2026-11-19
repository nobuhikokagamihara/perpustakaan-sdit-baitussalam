import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  ALL_BACKUP_TABLES,
  BACKUP_MODULES,
  type BackupModuleId,
  buildBackupEnvelope,
  computeRestoreDiff,
  evaluateBackupHealth,
  normalizeSelectedModules,
  resolveTablesForModules,
  validateBackupEnvelope,
} from '@/lib/domain/settings-backup-rules';

const ALLOWED_TABLE_SET = new Set(ALL_BACKUP_TABLES);

function getLiveTableCounts(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tbl of ALL_BACKUP_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${tbl}`).get() as { c: number };
      counts[tbl] = Number(row?.c || 0);
    } catch {
      counts[tbl] = 0;
    }
  }
  return counts;
}

function dumpTables(
  db: Database.Database,
  tableNames: string[]
): Record<string, Array<Record<string, unknown>>> {
  const data: Record<string, Array<Record<string, unknown>>> = {};
  for (const tbl of tableNames) {
    if (!ALLOWED_TABLE_SET.has(tbl)) continue;
    try {
      data[tbl] = db.prepare(`SELECT * FROM ${tbl}`).all() as Array<Record<string, unknown>>;
    } catch {
      data[tbl] = [];
    }
  }
  return data;
}

function generateSnapshotCode(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  const rand = Math.floor(100 + Math.random() * 900);
  return `SNP-${stamp}-${rand}`;
}

function saveSnapshotToDb(
  db: Database.Database,
  params: {
    label: string;
    notes?: string;
    selectedModules: BackupModuleId[];
    userId: number;
    userName: string;
    isAutoSafety?: boolean;
  }
) {
  const tablesToDump = resolveTablesForModules(params.selectedModules);
  const tables = dumpTables(db, tablesToDump);
  const snapshotCode = generateSnapshotCode();

  const envelope = buildBackupEnvelope({
    backupId: snapshotCode,
    label: params.label,
    sourceEngine: 'sqlite',
    exportedBy: params.userName,
    selectedModules: params.selectedModules,
    tables,
  });

  const payloadJson = JSON.stringify(envelope);
  const sizeBytes = Buffer.byteLength(payloadJson, 'utf8');

  const inserted = db
    .prepare(
      `INSERT INTO backup_snapshots
        (snapshot_code, label, notes, mode, modules_json, checksum, total_records, size_bytes, table_counts_json, payload_json, created_by_user_id, created_by_name, is_auto_safety)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      snapshotCode,
      envelope.label,
      (params.notes || '').trim().slice(0, 300),
      envelope.mode,
      JSON.stringify(envelope.selectedModules),
      envelope.checksum,
      envelope.totalRecords,
      sizeBytes,
      JSON.stringify(envelope.tableCounts),
      payloadJson,
      params.userId,
      params.userName,
      params.isAutoSafety ? 1 : 0
    );

  // Enforce retention count if configured (keep newest N snapshots)
  const retentionRow = db
    .prepare("SELECT value FROM library_settings WHERE key = 'backup_retention_count'")
    .get() as { value?: string } | undefined;
  const retentionCap = Math.max(3, Math.min(50, Number(retentionRow?.value || 10)));
  const allSnapIds = db
    .prepare('SELECT id FROM backup_snapshots ORDER BY created_at DESC, id DESC')
    .all() as Array<{ id: number }>;
  if (allSnapIds.length > retentionCap) {
    const toRemove = allSnapIds.slice(retentionCap).map((r) => r.id);
    const delStmt = db.prepare('DELETE FROM backup_snapshots WHERE id = ?');
    for (const rid of toRemove) {
      delStmt.run(rid);
    }
  }

  return {
    id: Number(inserted.lastInsertRowid),
    snapshot_code: snapshotCode,
    label: envelope.label,
    notes: (params.notes || '').trim().slice(0, 300),
    mode: envelope.mode,
    selectedModules: envelope.selectedModules,
    checksum: envelope.checksum,
    total_records: envelope.totalRecords,
    size_bytes: sizeBytes,
    table_counts: envelope.tableCounts,
    created_by_name: params.userName,
    is_auto_safety: params.isAutoSafety ? 1 : 0,
    created_at: envelope.exportedAt,
    envelope,
  };
}

function getBackupMeta(db: Database.Database) {
  const tableCounts = getLiveTableCounts(db);
  const moduleStats = BACKUP_MODULES.map((mod) => {
    let rows = 0;
    const tables = mod.sqliteTables.map((t) => {
      const count = tableCounts[t] || 0;
      rows += count;
      return { table: t, count };
    });
    return {
      id: mod.id,
      label: mod.label,
      description: mod.description,
      defaultSelected: mod.defaultSelected,
      tableCount: mod.sqliteTables.length,
      rowCount: rows,
      tables,
    };
  });

  const totalTables = ALL_BACKUP_TABLES.length;
  const totalRecords = Object.values(tableCounts).reduce((a, b) => a + b, 0);

  const snapshotRows = db
    .prepare(
      `SELECT id, snapshot_code, label, notes, mode, modules_json, checksum, total_records,
              size_bytes, table_counts_json, created_by_name, is_auto_safety, created_at
       FROM backup_snapshots
       ORDER BY created_at DESC, id DESC
       LIMIT 50`
    )
    .all() as Array<Record<string, unknown>>;

  const snapshots = snapshotRows.map((row) => ({
    id: Number(row.id),
    snapshot_code: String(row.snapshot_code),
    label: String(row.label),
    notes: String(row.notes || ''),
    mode: String(row.mode || 'full'),
    modules: (() => {
      try {
        return JSON.parse(String(row.modules_json || '[]')) as BackupModuleId[];
      } catch {
        return [];
      }
    })(),
    checksum: String(row.checksum || ''),
    total_records: Number(row.total_records || 0),
    size_bytes: Number(row.size_bytes || 0),
    table_counts: (() => {
      try {
        return JSON.parse(String(row.table_counts_json || '{}')) as Record<string, number>;
      } catch {
        return {};
      }
    })(),
    created_by_name: String(row.created_by_name || 'Super Admin'),
    is_auto_safety: Number(row.is_auto_safety || 0) === 1,
    created_at: String(row.created_at),
  }));

  const policyRows = db
    .prepare(
      `SELECT key, value FROM library_settings
       WHERE key IN ('backup_auto_frequency', 'backup_retention_count', 'backup_include_audit_logs')`
    )
    .all() as Array<{ key: string; value: string }>;
  const policy: Record<string, string> = {
    backup_auto_frequency: 'weekly',
    backup_retention_count: '10',
    backup_include_audit_logs: 'false',
  };
  for (const r of policyRows) policy[r.key] = r.value;

  const lastSnapshotAt = snapshots[0]?.created_at || null;
  const health = evaluateBackupHealth(lastSnapshotAt, policy.backup_auto_frequency);

  return {
    sourceEngine: 'sqlite',
    totalTables,
    totalRecords,
    tableCounts,
    moduleStats,
    snapshots,
    policy,
    health,
  };
}

export async function GET(req: NextRequest) {
  const { user: auth, errorResponse } = await requirePermission('settings.write');
  if (errorResponse) return errorResponse;
  const db = getDb();

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || '';
  const snapshotId = searchParams.get('snapshotId');

  // 1. Metadata & Snapshot History View
  if (mode === 'meta') {
    return NextResponse.json(getBackupMeta(db));
  }

  // 2. Download a specific saved snapshot
  if (snapshotId) {
    const row = db
      .prepare('SELECT snapshot_code, payload_json FROM backup_snapshots WHERE id = ?')
      .get(Number(snapshotId)) as { snapshot_code: string; payload_json: string } | undefined;
    if (!row) {
      return NextResponse.json({ error: 'Snapshot tidak ditemukan.' }, { status: 404 });
    }
    logAudit(db, {
      userId: auth.id,
      userName: auth.fullName,
      action: 'BACKUP_SNAPSHOT_DOWNLOAD',
      entityType: 'backup_snapshot',
      entityId: String(snapshotId),
      after: { snapshotCode: row.snapshot_code },
    });
    return new NextResponse(row.payload_json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lentera-pustaka-${row.snapshot_code.toLowerCase()}.json"`,
      },
    });
  }

  // 3. Live Backup Export (Full or Selective Modules)
  const modulesParam = searchParams.get('modules');
  const includeAudit = searchParams.get('includeAudit') === '1' || searchParams.get('includeAudit') === 'true';
  const saveSnapshot = searchParams.get('saveSnapshot') === '1' || searchParams.get('saveSnapshot') === 'true';
  const label = searchParams.get('label') || 'Backup Unduhan Manual';

  const selectedModules = normalizeSelectedModules(
    modulesParam ? modulesParam.split(',') : undefined,
    includeAudit
  );

  let envelope;
  if (saveSnapshot) {
    const saved = db.transaction(() => {
      const snap = saveSnapshotToDb(db, {
        label,
        notes: 'Disimpan otomatis bersamaan dengan unduhan berkas JSON.',
        selectedModules,
        userId: auth.id,
        userName: auth.fullName,
      });
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'DATABASE_BACKUP',
        entityType: 'backup',
        entityId: snap.snapshot_code,
        after: {
          mode: snap.mode,
          modules: snap.selectedModules,
          totalRecords: snap.total_records,
          checksum: snap.checksum.slice(0, 12),
          savedSnapshot: true,
        },
      });
      return snap;
    })();
    envelope = saved.envelope;
  } else {
    const tablesToDump = resolveTablesForModules(selectedModules);
    const tables = dumpTables(db, tablesToDump);
    const backupId = generateSnapshotCode();
    envelope = buildBackupEnvelope({
      backupId,
      label,
      sourceEngine: 'sqlite',
      exportedBy: auth.fullName,
      selectedModules,
      tables,
    });
    logAudit(db, {
      userId: auth.id,
      userName: auth.fullName,
      action: 'DATABASE_BACKUP',
      entityType: 'backup',
      entityId: backupId,
      after: {
        mode: envelope.mode,
        modules: envelope.selectedModules,
        totalRecords: envelope.totalRecords,
        checksum: envelope.checksum.slice(0, 12),
      },
    });
  }

  const filename = `lentera-pustaka-${envelope.mode}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function POST(req: NextRequest) {
  const { user: auth, errorResponse } = await requirePermission('settings.write');
  if (errorResponse) return errorResponse;
  const db = getDb();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Format berkas JSON tidak valid.' }, { status: 400 });
  }

  const action = String(body.action || (body.confirmed ? 'restore' : 'verify'));

  // 1. Create a persistent server-side snapshot
  if (action === 'create_snapshot') {
    const label = String(body.label || '').trim() || `Snapshot ${new Date().toLocaleDateString('id-ID')}`;
    const notes = String(body.notes || '').trim();
    const includeAudit = Boolean(body.includeAudit);
    const requestedModules = Array.isArray(body.modules) ? (body.modules as string[]) : undefined;
    const selectedModules = normalizeSelectedModules(requestedModules, includeAudit);

    const saved = db.transaction(() => {
      const snap = saveSnapshotToDb(db, {
        label,
        notes,
        selectedModules,
        userId: auth.id,
        userName: auth.fullName,
      });
      logAudit(db, {
        userId: auth.id,
        userName: auth.fullName,
        action: 'BACKUP_SNAPSHOT_CREATE',
        entityType: 'backup_snapshot',
        entityId: snap.snapshot_code,
        after: {
          label: snap.label,
          mode: snap.mode,
          modules: snap.selectedModules,
          totalRecords: snap.total_records,
          sizeBytes: snap.size_bytes,
        },
      });
      return snap;
    })();

    return NextResponse.json({
      ok: true,
      snapshot: {
        id: saved.id,
        snapshot_code: saved.snapshot_code,
        label: saved.label,
        notes: saved.notes,
        mode: saved.mode,
        modules: saved.selectedModules,
        checksum: saved.checksum,
        total_records: saved.total_records,
        size_bytes: saved.size_bytes,
        created_by_name: saved.created_by_name,
        is_auto_safety: false,
        created_at: saved.created_at,
      },
    });
  }

  // Load backup payload either from uploaded JSON or from saved snapshotId
  let backupPayload: Record<string, unknown> | null = null;
  let sourceLabel = 'Unggahan JSON';

  if (body.snapshotId) {
    const snapRow = db
      .prepare('SELECT snapshot_code, label, payload_json FROM backup_snapshots WHERE id = ?')
      .get(Number(body.snapshotId)) as
      | { snapshot_code: string; label: string; payload_json: string }
      | undefined;
    if (!snapRow) {
      return NextResponse.json({ error: 'Snapshot yang dipilih tidak ditemukan.' }, { status: 404 });
    }
    try {
      backupPayload = JSON.parse(snapRow.payload_json) as Record<string, unknown>;
      sourceLabel = `Snapshot ${snapRow.snapshot_code} (${snapRow.label})`;
    } catch {
      return NextResponse.json({ error: 'Isi snapshot rusak dan tidak dapat dibaca.' }, { status: 500 });
    }
  } else if (body.backup && typeof body.backup === 'object') {
    backupPayload = body.backup as Record<string, unknown>;
  }

  if (!backupPayload) {
    return NextResponse.json({ error: 'Berkas cadangan atau ID snapshot wajib disertakan.' }, { status: 400 });
  }

  const validation = validateBackupEnvelope(backupPayload);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.reason,
        checksumStatus: validation.checksumStatus,
      },
      { status: 400 }
    );
  }

  const tables = backupPayload.tables as Record<string, Array<Record<string, unknown>>>;
  const currentCounts = getLiveTableCounts(db);
  const availableModules = validation.selectedModules || [];
  const diff = computeRestoreDiff(currentCounts, tables);

  // 2. Verify / Dry-run preview with diff
  if (action === 'verify') {
    return NextResponse.json({
      ok: true,
      summary: {
        version: validation.version,
        mode: validation.mode,
        sourceEngine: validation.sourceEngine,
        label: validation.label,
        exportedAt: validation.exportedAt,
        exportedBy: validation.exportedBy,
        checksumStatus: validation.checksumStatus,
        checksum: validation.expectedChecksum || validation.computedChecksum || null,
        selectedModules: availableModules,
        totalRecords: validation.totalRecords || 0,
        booksCount: (tables.books || []).length,
        copiesCount: (tables.book_copies || []).length,
        membersCount: (tables.members || []).length,
        loansCount: (tables.loans || []).length,
        schedulesCount: (tables.reading_schedules || []).length,
      },
      diff,
    });
  }

  // 3. Execute Restore (Full or Selective Modules) with optional Pre-Restore Auto Safety Snapshot
  if (action === 'restore') {
    const hasExplicitSelection = Array.isArray(body.selectedModules);
    const requestedModules = hasExplicitSelection
      ? (body.selectedModules as string[])
      : availableModules;
    const matchedModules = requestedModules.filter((m) =>
      availableModules.includes(m as BackupModuleId)
    );
    if (hasExplicitSelection && matchedModules.length === 0) {
      return NextResponse.json(
        { error: 'Tidak ada modul yang dipilih tersedia pada berkas cadangan ini.' },
        { status: 400 }
      );
    }
    const modulesToRestore = normalizeSelectedModules(
      matchedModules,
      matchedModules.includes('audit') && availableModules.includes('audit')
    );

    const tablesToRestore = resolveTablesForModules(modulesToRestore).filter((tbl) =>
      Array.isArray(tables[tbl])
    );

    if (tablesToRestore.length === 0) {
      return NextResponse.json(
        { error: 'Tidak ada modul valid dalam berkas cadangan untuk dipulihkan.' },
        { status: 400 }
      );
    }

    const createSafetySnapshot = body.createSafetySnapshot !== false;
    let safetySnapshotCode: string | null = null;

    if (createSafetySnapshot) {
      const safetySnap = saveSnapshotToDb(db, {
        label: `Auto Safety Sebelum Restore (${validation.label || sourceLabel})`,
        notes: `Cadangan pengaman otomatis dibuat sebelum pemulihan modul: ${modulesToRestore.join(', ')}`,
        selectedModules: normalizeSelectedModules(undefined, false),
        userId: auth.id,
        userName: auth.fullName,
        isAutoSafety: true,
      });
      safetySnapshotCode = safetySnap.snapshot_code;
    }

    let restoredRowsTotal = 0;

    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        // Delete child -> parent order for selected tables only
        for (const tbl of [...tablesToRestore].reverse()) {
          if (!ALLOWED_TABLE_SET.has(tbl)) continue;
          db.prepare(`DELETE FROM ${tbl}`).run();
        }

        // Insert parent -> child order with PRAGMA table_info column intersection
        for (const tbl of tablesToRestore) {
          if (!ALLOWED_TABLE_SET.has(tbl)) continue;
          const rows = tables[tbl] || [];
          if (!rows.length) continue;

          const schemaCols = new Set(
            (db.prepare(`PRAGMA table_info(${tbl})`).all() as Array<{ name: string }>).map(
              (c) => c.name
            )
          );

          for (const row of rows) {
            const cols = Object.keys(row).filter((k) => schemaCols.has(k));
            if (cols.length === 0) continue;
            const placeholders = cols.map(() => '?').join(', ');
            const stmt = db.prepare(
              `INSERT OR REPLACE INTO ${tbl} (${cols.join(', ')}) VALUES (${placeholders})`
            );
            stmt.run(...cols.map((c) => row[c] ?? null));
            restoredRowsTotal++;
          }
        }

        logAudit(db, {
          userId: auth.id,
          userName: auth.fullName,
          action: 'DATABASE_RESTORE',
          entityType: 'backup',
          entityId: safetySnapshotCode || 'restore',
          after: {
            source: sourceLabel,
            modulesRestored: modulesToRestore,
            tablesRestored: tablesToRestore.length,
            restoredRowsTotal,
            safetySnapshotCode,
            checksumStatus: validation.checksumStatus,
          },
        });
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    return NextResponse.json({
      ok: true,
      restoredTables: tablesToRestore.length,
      restoredRows: restoredRowsTotal,
      modulesRestored: modulesToRestore,
      safetySnapshotCode,
    });
  }

  return NextResponse.json({ error: 'Aksi backup/restore tidak dikenali.' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { user: auth, errorResponse } = await requirePermission('settings.write');
  if (errorResponse) return errorResponse;
  const db = getDb();

  const { searchParams } = new URL(req.url);
  const snapshotId = Number(searchParams.get('snapshotId') || 0);
  if (!snapshotId) {
    return NextResponse.json({ error: 'ID snapshot wajib disertakan.' }, { status: 400 });
  }

  const existing = db
    .prepare('SELECT id, snapshot_code, label, total_records FROM backup_snapshots WHERE id = ?')
    .get(snapshotId) as
    | { id: number; snapshot_code: string; label: string; total_records: number }
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Snapshot tidak ditemukan.' }, { status: 404 });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM backup_snapshots WHERE id = ?').run(snapshotId);
    logAudit(db, {
      userId: auth.id,
      userName: auth.fullName,
      action: 'BACKUP_SNAPSHOT_DELETE',
      entityType: 'backup_snapshot',
      entityId: String(snapshotId),
      before: existing,
    });
  })();

  return NextResponse.json({ ok: true });
}
