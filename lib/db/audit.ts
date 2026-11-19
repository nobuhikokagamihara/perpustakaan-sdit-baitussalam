import type Database from 'better-sqlite3';

export interface AuditEntryInput {
  userId?: number | null;
  userName?: string;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}

export function logAudit(db: Database.Database, entry: AuditEntryInput): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, before_json, after_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId ?? null,
    entry.userName ?? 'Sistem',
    entry.action,
    entry.entityType,
    String(entry.entityId),
    entry.before !== undefined ? JSON.stringify(entry.before) : null,
    entry.after !== undefined ? JSON.stringify(entry.after) : null,
    entry.ipAddress ?? '127.0.0.1'
  );
}
