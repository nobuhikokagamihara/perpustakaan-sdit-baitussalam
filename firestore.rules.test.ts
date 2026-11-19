import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();
const BLUEPRINT_PATH = path.join(ROOT, 'firebase-blueprint.json');
const RULES_PATH = path.join(
  ROOT,
  fs.existsSync(path.join(ROOT, 'firestore.rules'))
    ? 'firestore.rules'
    : 'DRAFT_firestore.rules'
);

const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')) as {
  entities: Record<string, { properties: Record<string, { maxLength?: number }> }>;
  firestore: Record<string, unknown>;
};
const rulesText = fs.readFileSync(RULES_PATH, 'utf8');

function extractBlock(marker: string): string {
  const idx = rulesText.indexOf(marker);
  if (idx === -1) return '';
  const bodyStart = rulesText.indexOf('{', idx + marker.length);
  if (bodyStart === -1) return '';
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < rulesText.length; i++) {
    const ch = rulesText[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return rulesText.slice(idx, end);
}

describe('Phase 0 Security Rules & Dirty Dozen Verification', () => {
  it('enforces rules_version 2 and global default-deny catch-all first', () => {
    assert.match(rulesText, /^rules_version\s*=\s*'2';/);
    const catchAllIdx = rulesText.indexOf('match /{document=**}');
    assert.ok(catchAllIdx > 0, 'Global catch-all match block must exist');
    assert.ok(
      rulesText.slice(catchAllIdx, catchAllIdx + 120).includes('allow read, write: if false;'),
      'Catch-all block must deny read and write'
    );
  });

  it('covers every collection path declared in firebase-blueprint.json', () => {
    const paths = Object.keys(blueprint.firestore);
    assert.equal(paths.length, 25);
    for (const p of paths) {
      const colName = p.split('/').filter(Boolean)[0];
      assert.ok(
        rulesText.includes(`match /${colName}/`),
        `Missing Firestore match block for collection /${colName}`
      );
    }
  });

  it('DD-01: prevents self-assigned privilege escalation on /users/{uid} creation', () => {
    const block = extractBlock('match /users/{uid}');
    assert.ok(block.includes("incoming().role == 'anggota'"));
    assert.ok(block.includes('incoming().role == existing().role'));
  });

  it('DD-02: requires email_verified == true on admin email check', () => {
    assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
    assert.ok(rulesText.includes("request.auth.token.email == 'nobuhikokagamihara@gmail.com'"));
  });

  it('DD-03: rejects shadow/ghost fields via affectedKeys().hasOnly() & isValid* blueprints', () => {
    const updateBlocks = (rulesText.match(/allow update:[\s\S]*?;/g) || []).filter(
      (ub) => !/allow update:\s*if\s+false\s*;/.test(ub)
    );
    assert.ok(updateBlocks.length >= 12);
    for (const ub of updateBlocks) {
      assert.ok(
        ub.includes('isValid'),
        `Every allow update block must invoke isValid[Entity]: ${ub.slice(0, 80)}`
      );
      assert.ok(
        ub.includes('affectedKeys().hasOnly('),
        `Every allow update block must restrict affectedKeys().hasOnly(): ${ub.slice(0, 80)}`
      );
    }
  });

  it('DD-04: isolates PII collections (/members, /users, /loans, /fines) from blanket reads', () => {
    assert.equal(/allow\s+(read|list|get)\s*:\s*if\s+isSignedIn\(\)\s*;/.test(rulesText), false);
    assert.equal(/allow\s+(read|write)\s*:\s*if\s+true\s*;/.test(rulesText), false);
    const membersBlock = extractBlock('match /members/{memberId}');
    assert.ok(membersBlock.includes('existing().ownerUid == request.auth.uid'));
    assert.ok(membersBlock.includes('resource.data.ownerUid == request.auth.uid'));
  });

  it('DD-05: enforces server timestamp integrity (request.time) on create and update', () => {
    assert.ok(rulesText.includes('incoming().createdAt == request.time'));
    assert.ok(rulesText.includes('incoming().updatedAt == request.time'));
    assert.ok(rulesText.includes('incoming().createdAt == existing().createdAt'));
  });

  it('DD-06: validates path variable IDs with isValidId() on single-document operations', () => {
    assert.ok(rulesText.includes("id.matches('^[a-zA-Z0-9_\\\\-]+$')"));
    const booksBlock = extractBlock('match /books/{bookId}');
    assert.ok(booksBlock.includes('isValidId(bookId)'));
  });

  it('DD-07: enforces bounded string lengths and array limits matching blueprint', () => {
    assert.ok(rulesText.includes('isNonEmptyString(data.title, 240)'));
    assert.ok(rulesText.includes('isOptionalString(data.coverUrl, 1000)'));
    assert.ok(rulesText.includes('isOptionalString(data.callNumber, 60)'));
    assert.ok(rulesText.includes('isOptionalString(data.tableOfContents, 2000)'));
    assert.ok(rulesText.includes('data.items is list && data.items.size() >= 1 && data.items.size() <= 20'));
    assert.equal(blueprint.entities.Book.properties.title.maxLength, 240);
    assert.equal(blueprint.entities.Book.properties.coverUrl.maxLength, 1000);
    assert.equal(blueprint.entities.PublicCatalogItem.properties.coverUrl.maxLength, 1000);
  });

  it('DD-08: locks terminal states on loans, fines, acquisitions, and inventory_audits', () => {
    const loansBlock = extractBlock('match /loans/{loanId}');
    const finesBlock = extractBlock('match /fines/{fineId}');
    const acqBlock = extractBlock('match /acquisitions/{acquisitionId}');
    const auditInvBlock = extractBlock('match /inventory_audits/{auditId}');
    assert.ok(loansBlock.includes("existing().status != 'Selesai'"));
    assert.ok(finesBlock.includes("existing().status in ['Belum Lunas', 'Sebagian']"));
    assert.ok(acqBlock.includes("!(existing().status in ['Selesai', 'Ditolak'])"));
    assert.ok(auditInvBlock.includes("existing().status != 'Selesai'"));
  });

  it('DD-09: rejects non-positive payment amounts', () => {
    assert.ok(rulesText.includes('data.amount is number && data.amount > 0'));
  });

  it('DD-10: keeps audit_logs, returns, and payments strictly append-only', () => {
    assert.ok(extractBlock('match /audit_logs/{logId}').includes('allow update, delete: if false;'));
    assert.ok(extractBlock('match /returns/{returnId}').includes('allow update, delete: if false;'));
    assert.ok(extractBlock('match /payments/{paymentId}').includes('allow update, delete: if false;'));
  });

  it('DD-11: enforces relational existence via existsAfter on child creates', () => {
    assert.ok(extractBlock('match /book_copies/{copyId}').includes('existsAfter(/databases/$(database)/documents/books/$(incoming().bookId))'));
    assert.ok(extractBlock('match /loans/{loanId}').includes('existsAfter(/databases/$(database)/documents/members/$(incoming().memberId))'));
    assert.ok(extractBlock('match /payments/{paymentId}').includes('existsAfter(/databases/$(database)/documents/fines/$(incoming().fineId))'));
  });

  it('DD-12: blocks hard deletes on historical library collections', () => {
    for (const col of ['books/{bookId}', 'public_catalog/{bookId}', 'book_copies/{copyId}', 'members/{memberId}', 'loans/{loanId}', 'fines/{fineId}', 'reading_schedules/{scheduleId}', 'school_classes/{classId}']) {
      assert.ok(extractBlock(`match /${col}`).includes('allow delete: if false;'), `/${col} must forbid delete`);
    }
  });

  it('DD-13: locks /backup_snapshots/{snapshotId} strictly to Admin with SHA-256 validation and append-only immutability', () => {
    const snapBlock = extractBlock('match /backup_snapshots/{snapshotId}');
    assert.ok(snapBlock.includes('isValidId(snapshotId) && isAdmin()'));
    assert.ok(snapBlock.includes('isValidBackupSnapshot(incoming())'));
    assert.ok(snapBlock.includes('incoming().createdByUid == request.auth.uid'));
    assert.ok(snapBlock.includes('incoming().createdAt == request.time'));
    assert.ok(snapBlock.includes('allow update: if false;'));
    assert.ok(rulesText.includes('data.checksum is string && data.checksum.size() == 64'));
  });
});
