import { formatCurrencyIDR } from './library-rules';

export interface QrMemberCandidate {
  id: number;
  member_code: string;
  full_name: string;
  status: string;
  expires_at?: string;
  membership_type_name: string;
  active_loans_count: number;
  max_loans: number;
  loan_duration_days: number;
  unpaid_fines_total: number;
}

export interface QrCopyCandidate {
  id: number;
  inventory_code: string;
  barcode: string;
  status: string;
  book_title: string;
  is_reference_only: number;
  read_in_place_only: number;
}

export type QrScanMode = 'auto' | 'member' | 'copy';

export interface ParsedQrPayload {
  raw: string;
  normalizedCode: string;
  hint: 'member' | 'copy' | 'unknown';
}

export type QrScanResolution =
  | {
      ok: true;
      kind: 'member';
      code: string;
      member: QrMemberCandidate;
      warning?: string;
    }
  | {
      ok: true;
      kind: 'copy';
      code: string;
      copy: QrCopyCandidate;
    }
  | {
      ok: false;
      code: string;
      status: 'invalid' | 'not_found' | 'unavailable' | 'duplicate' | 'limit_reached' | 'wrong_mode';
      reason: string;
    };

function inferHintFromCode(code: string): 'member' | 'copy' | 'unknown' {
  const upper = code.toUpperCase();
  if (upper.startsWith('AGT-') || upper.startsWith('MEM-') || upper.startsWith('MEMBER-')) {
    return 'member';
  }
  if (upper.startsWith('BC') || upper.startsWith('LP-') || upper.startsWith('INV-')) {
    return 'copy';
  }
  return 'unknown';
}

export function parseQrPayload(rawText: string): ParsedQrPayload {
  const raw = (rawText || '').trim();
  if (!raw) {
    return { raw: '', normalizedCode: '', hint: 'unknown' };
  }

  // 1. JSON payload support (e.g. {"type":"member","code":"AGT-2026-0001"})
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const memberVal = parsed.memberCode ?? parsed.member_code;
      if (typeof memberVal === 'string' && memberVal.trim()) {
        return { raw, normalizedCode: memberVal.trim(), hint: 'member' };
      }
      const copyVal = parsed.barcode ?? parsed.inventoryCode ?? parsed.inventory_code;
      if (typeof copyVal === 'string' && copyVal.trim()) {
        return { raw, normalizedCode: copyVal.trim(), hint: 'copy' };
      }
      const genericCode = parsed.code ?? parsed.id;
      if (typeof genericCode === 'string' && genericCode.trim()) {
        const typeStr = String(parsed.type || '').toLowerCase();
        const hint =
          typeStr === 'member' || typeStr === 'anggota'
            ? 'member'
            : typeStr === 'copy' || typeStr === 'book' || typeStr === 'buku'
              ? 'copy'
              : inferHintFromCode(genericCode.trim());
        return { raw, normalizedCode: genericCode.trim(), hint };
      }
    } catch {
      // Not valid JSON, fall through to other formats
    }
  }

  // 2. Prefix format (MEMBER:AGT-2026-0001, COPY:BC20260001, INV:LP-2026-0001)
  const prefixMatch = raw.match(/^(MEMBER|ANGGOTA|AGT|COPY|BOOK|BUKU|BARCODE|INV)\s*:\s*(.+)$/i);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toUpperCase();
    const code = prefixMatch[2].trim();
    const hint =
      prefix === 'MEMBER' || prefix === 'ANGGOTA' || prefix === 'AGT' ? 'member' : 'copy';
    return { raw, normalizedCode: code, hint };
  }

  // 3. URL / deep link format (https://.../members?code=AGT-2026-0001 or lentera://copy/BC20260001)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const paramCode =
        url.searchParams.get('member_code') ||
        url.searchParams.get('memberCode') ||
        url.searchParams.get('barcode') ||
        url.searchParams.get('inventory_code') ||
        url.searchParams.get('code');
      if (paramCode && paramCode.trim()) {
        const code = paramCode.trim();
        const pathLower = url.pathname.toLowerCase();
        const hint =
          url.searchParams.has('member_code') ||
          url.searchParams.has('memberCode') ||
          pathLower.includes('member')
            ? 'member'
            : url.searchParams.has('barcode') ||
                url.searchParams.has('inventory_code') ||
                pathLower.includes('book') ||
                pathLower.includes('copy')
              ? 'copy'
              : inferHintFromCode(code);
        return { raw, normalizedCode: code, hint };
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1];
      if (lastSeg) {
        const decoded = decodeURIComponent(lastSeg).trim();
        const fullLower = `${url.hostname}/${url.pathname}`.toLowerCase();
        const hint = fullLower.includes('member')
          ? 'member'
          : fullLower.includes('copy') || fullLower.includes('book')
            ? 'copy'
            : inferHintFromCode(decoded);
        return { raw, normalizedCode: decoded, hint };
      }
    } catch {
      // Fall through if URL constructor rejects custom malformed string
    }
  }

  // 4. Direct plain code (AGT-2026-0001, BC20260001, LP-2026-0001)
  return {
    raw,
    normalizedCode: raw,
    hint: inferHintFromCode(raw),
  };
}

export function resolveQrCheckoutScan(params: {
  rawText: string;
  members: QrMemberCandidate[];
  copies: QrCopyCandidate[];
  basketCopyIds: number[];
  selectedMember: QrMemberCandidate | null;
  todayStr: string;
  scanMode?: QrScanMode;
}): QrScanResolution {
  const {
    rawText,
    members,
    copies,
    basketCopyIds,
    selectedMember,
    todayStr,
    scanMode = 'auto',
  } = params;

  const parsed = parseQrPayload(rawText);
  if (!parsed.normalizedCode) {
    return {
      ok: false,
      code: '',
      status: 'invalid',
      reason: 'Kode QR kosong atau tidak terbaca.',
    };
  }

  const term = parsed.normalizedCode.toLowerCase();

  const matchedMember =
    members.find((m) => m.member_code.toLowerCase() === term) || null;
  const matchedCopy =
    copies.find(
      (c) =>
        c.barcode.toLowerCase() === term ||
        c.inventory_code.toLowerCase() === term
    ) || null;

  const resolveMember = (): QrScanResolution | null => {
    if (!matchedMember) return null;
    if (scanMode === 'copy') {
      return {
        ok: false,
        code: parsed.normalizedCode,
        status: 'wrong_mode',
        reason: `QR "${matchedMember.member_code}" adalah Kartu Anggota (${matchedMember.full_name}). Ubah mode ke Otomatis atau Kartu Anggota.`,
      };
    }

    let warning: string | undefined;
    if (matchedMember.status === 'Diblokir') {
      warning = 'Anggota ini berstatus Diblokir dan tidak dapat meminjam buku.';
    } else if (matchedMember.status !== 'Aktif') {
      warning = `Status keanggotaan ${matchedMember.status}.`;
    } else if (matchedMember.expires_at && matchedMember.expires_at < todayStr) {
      warning = `Masa berlaku keanggotaan habis pada ${matchedMember.expires_at}.`;
    } else if (matchedMember.active_loans_count >= matchedMember.max_loans) {
      warning = `Kuota pinjaman anggota sudah penuh (${matchedMember.active_loans_count}/${matchedMember.max_loans} buku).`;
    } else if (matchedMember.unpaid_fines_total > 0) {
      warning = `Memiliki tunggakan denda ${formatCurrencyIDR(matchedMember.unpaid_fines_total)}.`;
    }

    return {
      ok: true,
      kind: 'member',
      code: matchedMember.member_code,
      member: matchedMember,
      warning,
    };
  };

  const resolveCopy = (): QrScanResolution | null => {
    if (!matchedCopy) return null;
    if (scanMode === 'member') {
      return {
        ok: false,
        code: parsed.normalizedCode,
        status: 'wrong_mode',
        reason: `QR "${matchedCopy.inventory_code}" adalah label buku (${matchedCopy.book_title}). Ubah mode ke Otomatis atau Label Buku.`,
      };
    }

    if (basketCopyIds.includes(matchedCopy.id)) {
      return {
        ok: false,
        code: matchedCopy.inventory_code,
        status: 'duplicate',
        reason: `${matchedCopy.book_title} (${matchedCopy.inventory_code}) sudah ada di keranjang peminjaman.`,
      };
    }

    if (matchedCopy.is_reference_only === 1) {
      return {
        ok: false,
        code: matchedCopy.inventory_code,
        status: 'unavailable',
        reason: `${matchedCopy.book_title} (${matchedCopy.inventory_code}) adalah koleksi referensi dan hanya boleh dibaca di tempat.`,
      };
    }

    if (matchedCopy.read_in_place_only === 1) {
      return {
        ok: false,
        code: matchedCopy.inventory_code,
        status: 'unavailable',
        reason: `${matchedCopy.book_title} (${matchedCopy.inventory_code}) berstatus baca di tempat.`,
      };
    }

    if (matchedCopy.status !== 'Tersedia') {
      return {
        ok: false,
        code: matchedCopy.inventory_code,
        status: 'unavailable',
        reason: `${matchedCopy.book_title} (${matchedCopy.inventory_code}) tidak tersedia untuk dipinjam (status: ${matchedCopy.status}).`,
      };
    }

    if (
      selectedMember &&
      selectedMember.active_loans_count + basketCopyIds.length + 1 > selectedMember.max_loans
    ) {
      return {
        ok: false,
        code: matchedCopy.inventory_code,
        status: 'limit_reached',
        reason: `Kuota pinjaman ${selectedMember.full_name} maksimal ${selectedMember.max_loans} buku (aktif: ${selectedMember.active_loans_count}, di keranjang: ${basketCopyIds.length}).`,
      };
    }

    return {
      ok: true,
      kind: 'copy',
      code: matchedCopy.inventory_code,
      copy: matchedCopy,
    };
  };

  if (parsed.hint === 'member' || scanMode === 'member') {
    const res = resolveMember() ?? resolveCopy();
    if (res) return res;
  } else {
    const res = resolveCopy() ?? resolveMember();
    if (res) return res;
  }

  return {
    ok: false,
    code: parsed.normalizedCode,
    status: 'not_found',
    reason: `Kode QR "${parsed.normalizedCode}" tidak cocok dengan data anggota maupun eksemplar buku.`,
  };
}
