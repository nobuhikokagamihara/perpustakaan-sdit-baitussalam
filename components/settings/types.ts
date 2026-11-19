import type { BackupHealthSummary, BackupModuleId, ModuleDiffRow } from '@/lib/domain/settings-backup-rules';

export interface MembershipTypeRow {
  id: number;
  code: string;
  name: string;
  max_loans: number;
  loan_duration_days: number;
  max_renewals: number;
  daily_fine_rate: number;
  max_fine_cap: number;
  allow_reservation: number;
  member_count?: number;
}

export interface RoleRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  category?: string;
  requires_approval?: number;
  is_system?: number;
  user_count?: number;
  permission_count?: number;
}

export interface PermissionRow {
  id: number;
  code: string;
  name: string;
  module: string;
}

export interface RolePermissionRow {
  role_id: number;
  permission_id: number;
}

export interface UserRow {
  id: number;
  uid?: string;
  username: string;
  email: string;
  full_name: string;
  is_active: number;
  role_id: number;
  role_name: string;
  role_slug: string;
  approval_status?: 'approved' | 'pending' | 'rejected';
  requested_role_id?: number | null;
  requested_role_name?: string | null;
  requested_role_slug?: string | null;
  approval_note?: string;
  approved_at?: string | null;
  created_at?: string;
}

export interface StaffRoleRow {
  uid: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

export interface AuditLogRow {
  id: number;
  user_id?: number | null;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json?: string | null;
  after_json?: string | null;
  ip_address?: string;
  created_at: string;
}

export interface SettingsPayload {
  settings: Record<string, string>;
  membershipTypes: MembershipTypeRow[];
  roles: RoleRow[];
  permissions: PermissionRow[];
  rolePermissions: RolePermissionRow[];
  users: UserRow[];
  staffRoles?: StaffRoleRow[];
  auditLogs: AuditLogRow[];
  backupSummary?: {
    snapshotCount: number;
    lastSnapshotAt: string | null;
    health: BackupHealthSummary;
  };
}

export interface BackupModuleStat {
  id: BackupModuleId;
  label: string;
  description: string;
  defaultSelected: boolean;
  tableCount: number;
  rowCount: number;
  tables: Array<{ table: string; count: number }>;
}

export interface BackupSnapshotItem {
  id: number;
  docId?: string;
  snapshot_code: string;
  label: string;
  notes: string;
  mode: string;
  modules: BackupModuleId[];
  checksum: string;
  total_records: number;
  size_bytes: number;
  table_counts: Record<string, number>;
  created_by_name: string;
  is_auto_safety: boolean;
  created_at: string;
}

export interface BackupMetaPayload {
  sourceEngine: 'sqlite' | 'firestore';
  totalTables: number;
  totalRecords: number;
  tableCounts: Record<string, number>;
  moduleStats: BackupModuleStat[];
  snapshots: BackupSnapshotItem[];
  policy: {
    backup_auto_frequency: string;
    backup_retention_count: string;
    backup_include_audit_logs: string;
  };
  health: BackupHealthSummary;
}

export interface RestoreVerifyResult {
  summary: {
    version: number;
    mode: string;
    sourceEngine: string;
    label: string;
    exportedAt: string;
    exportedBy: string;
    checksumStatus: 'verified' | 'mismatch' | 'legacy_no_checksum';
    checksum: string | null;
    selectedModules: BackupModuleId[];
    totalRecords: number;
    booksCount: number;
    copiesCount: number;
    membersCount: number;
    loansCount: number;
    schedulesCount: number;
  };
  diff: ModuleDiffRow[];
}
