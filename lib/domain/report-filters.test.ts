import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_TYPES,
  buildPdfReportDocumentModel,
  buildReportExportMeta,
  computeCirculationSummary,
  doesAcquisitionTextMatchClass,
  doesReportSupportCategoryFilter,
  doesTargetGradeMatchClass,
  extractCityFromAddress,
  extractGradeFromClassFilter,
  formatIndonesianDate,
  formatPdfCellValue,
  getReportCategoryFilterHint,
  getReportClassFilterHint,
  getReportColumnAlignment,
  isCirculationReportType,
  matchesExactClass,
  normalizeClassFilter,
  toSafeFilenameSlug,
} from './report-filters';

test('REPORT_TYPES covers all 16 report pages including unified circulation report', () => {
  assert.equal(REPORT_TYPES.length, 16);
  const values = new Set(REPORT_TYPES.map((r) => r.value));
  for (const expected of [
    'circulation',
    'loans',
    'returns',
    'overdue',
    'collection',
    'available',
    'active_members',
    'most_active_members',
    'popular_books',
    'popular_categories',
    'fines',
    'payments',
    'acquisitions',
    'inventory',
    'lost_damaged',
    'class_rosters',
  ]) {
    assert.ok(values.has(expected), `Missing report type ${expected}`);
  }
  assert.equal(isCirculationReportType('circulation'), true);
  assert.equal(isCirculationReportType('loans'), true);
  assert.equal(isCirculationReportType('returns'), true);
  assert.equal(isCirculationReportType('overdue'), true);
  assert.equal(isCirculationReportType('collection'), false);
  assert.equal(doesReportSupportCategoryFilter('circulation'), true);
  assert.equal(doesReportSupportCategoryFilter('class_rosters'), false);
});

test('normalizeClassFilter trims whitespace and matchesExactClass is case-insensitive', () => {
  assert.equal(normalizeClassFilter('  Kelas   5A  '), 'Kelas 5A');
  assert.equal(normalizeClassFilter(''), '');
  assert.equal(matchesExactClass('Kelas 5A', 'kelas 5a'), true);
  assert.equal(matchesExactClass('Kelas 5B', 'Kelas 5A'), false);
  assert.equal(matchesExactClass('Wali Kelas 4A', 'Kelas 4A'), false);
  assert.equal(matchesExactClass('Kelas 2B', ''), true);
});

test('extractGradeFromClassFilter parses standard and custom SD rombels accurately', () => {
  assert.equal(extractGradeFromClassFilter('Kelas 1A'), 1);
  assert.equal(extractGradeFromClassFilter('Kelas 6D'), 6);
  assert.equal(extractGradeFromClassFilter('Kelas 5 Unggulan'), 5);
  assert.equal(extractGradeFromClassFilter('Wali Kelas 4A'), 4);
  assert.equal(extractGradeFromClassFilter('Tata Usaha Sekolah'), null);
  assert.equal(extractGradeFromClassFilter(''), null);
});

test('doesTargetGradeMatchClass filters collection suitability by SD grade level', () => {
  assert.equal(doesTargetGradeMatchClass('Semua Kelas (1–6 SD)', 'Kelas 1A'), true);
  assert.equal(doesTargetGradeMatchClass('Semua Kelas (1–6 SD)', 'Kelas 6B'), true);

  assert.equal(doesTargetGradeMatchClass('Kelas Rendah (1–3 SD)', 'Kelas 2B'), true);
  assert.equal(doesTargetGradeMatchClass('Kelas Rendah (1–3 SD)', 'Kelas 5A'), false);

  assert.equal(doesTargetGradeMatchClass('Kelas Tinggi (4–6 SD)', 'Kelas 5A'), true);
  assert.equal(doesTargetGradeMatchClass('Kelas Tinggi (4–6 SD)', 'Kelas 1B'), false);

  assert.equal(doesTargetGradeMatchClass('Kelas 4 SD', 'Kelas 4A'), true);
  assert.equal(doesTargetGradeMatchClass('Kelas 4 SD', 'Kelas 5A'), false);

  assert.equal(doesTargetGradeMatchClass('Guru & Pendidik', 'Kelas 3A'), false);
  assert.equal(doesTargetGradeMatchClass('Guru & Pendidik', 'Guru IPA & Sains SD'), true);
});

test('doesAcquisitionTextMatchClass matches grade ranges and specific class mentions', () => {
  const lowGradeAcq = {
    titleSummary: 'Pengadaan Buku Cerita Bergambar & Literasi Kelas 1–3',
    notes: 'Diterima lengkap dan telah disusun di pojok baca',
  };
  const highGradeAcq = {
    titleSummary: 'Usulan Buku Eksperimen Sains & Cerita Rakyat Semester Genap',
    notes: 'Usulan guru kelas 4–6 untuk pojok sains sekolah',
  };

  assert.equal(doesAcquisitionTextMatchClass(lowGradeAcq, 'Kelas 2B'), true);
  assert.equal(doesAcquisitionTextMatchClass(lowGradeAcq, 'Kelas 5A'), false);

  assert.equal(doesAcquisitionTextMatchClass(highGradeAcq, 'Kelas 5A'), true);
  assert.equal(doesAcquisitionTextMatchClass(highGradeAcq, 'Kelas 1A'), false);

  assert.equal(
    doesAcquisitionTextMatchClass({ titleSummary: 'Buku Paket Kelas 6D Khusus' }, 'Kelas 6D'),
    true
  );
});

test('buildReportExportMeta and filter hints format category and class scoped titles safely', () => {
  assert.equal(toSafeFilenameSlug('Kelas 5A / Unggulan'), 'kelas-5a-unggulan');

  const unfiltered = buildReportExportMeta({
    reportType: 'loans',
    reportLabel: 'Laporan Peminjaman',
  });
  assert.equal(unfiltered.title, 'Laporan Peminjaman');
  assert.equal(unfiltered.baseFilename, 'laporan-loans');

  const classOnly = buildReportExportMeta({
    reportType: 'loans',
    reportLabel: 'Laporan Peminjaman',
    className: 'Kelas 5A',
  });
  assert.equal(classOnly.title, 'Laporan Peminjaman — Kelas 5A');
  assert.equal(classOnly.baseFilename, 'laporan-loans-kelas-5a');

  const categoryOnly = buildReportExportMeta({
    reportType: 'circulation',
    reportLabel: 'Laporan Sirkulasi (Pinjam & Kembali)',
    categoryName: 'Cerita Anak & Dongeng',
  });
  assert.equal(
    categoryOnly.title,
    'Laporan Sirkulasi (Pinjam & Kembali) — Kategori: Cerita Anak & Dongeng'
  );
  assert.equal(categoryOnly.baseFilename, 'laporan-circulation-cerita-anak-dongeng');

  const both = buildReportExportMeta({
    reportType: 'circulation',
    reportLabel: 'Laporan Sirkulasi (Pinjam & Kembali)',
    categoryName: 'Sains SD',
    className: 'Kelas 5A',
  });
  assert.equal(
    both.title,
    'Laporan Sirkulasi (Pinjam & Kembali) — Kategori: Sains SD · Kelas 5A'
  );
  assert.equal(both.baseFilename, 'laporan-circulation-sains-sd-kelas-5a');

  assert.ok(getReportClassFilterHint('popular_books', 'Kelas 5A').includes('Kelas 5A'));
  assert.ok(
    getReportCategoryFilterHint('circulation', 'Cerita Anak').includes('sirkulasi khusus kategori buku Cerita Anak')
  );
  assert.ok(
    getReportCategoryFilterHint('class_rosters', 'Cerita Anak').includes('hanya berlaku pada laporan sirkulasi')
  );
});

test('computeCirculationSummary tallies borrowed, returned, overdue, and total fines accurately', () => {
  const summary = computeCirculationSummary([
    { Status: 'Dipinjam', Denda: 0 },
    { Status: 'Dikembalikan', Denda: 0 },
    { Status: 'Tepat Waktu', Denda: 0 },
    { Status: 'Terlambat', Denda: 2500 },
    { Status: 'Dikembalikan (Terlambat)', Denda: 1500 },
  ]);
  assert.equal(summary.totalItems, 5);
  assert.equal(summary.borrowed, 1);
  assert.equal(summary.returned, 3);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.totalFine, 4000);
});

test('buildPdfReportDocumentModel produces complete institutional letterhead, metadata, currency formatting, and alignments', () => {
  assert.equal(extractCityFromAddress('Jl. Pendidikan Nusantara No. 12, Jakarta'), 'Jakarta');
  assert.equal(extractCityFromAddress('Jl. Dago No. 8, Kota Bandung 40135'), 'Bandung');
  assert.equal(formatIndonesianDate('2026-11-20'), '20 November 2026');
  assert.equal(formatPdfCellValue('Denda', 5000), 'Rp 5.000');
  assert.equal(formatPdfCellValue('Tanggal_Kembali', '2026-11-18 14:22:10'), '2026-11-18');
  assert.equal(getReportColumnAlignment('Denda'), 'right');
  assert.equal(getReportColumnAlignment('Status'), 'center');
  assert.equal(getReportColumnAlignment('Judul_Buku'), 'left');

  const model = buildPdfReportDocumentModel({
    title: 'Laporan Sirkulasi (Pinjam & Kembali) — Kategori: Cerita Anak',
    rows: [
      {
        No_Transaksi: 'PJM-2026-0001',
        Anggota: 'Bima Pratama',
        Rombel_Kelas: 'Kelas 5A',
        Judul_Buku: 'Petualangan Kancil',
        Kategori_Buku: 'Cerita Anak',
        Tanggal_Pinjam: '2026-11-01',
        Status: 'Dikembalikan',
        Denda: 1500,
      },
    ],
    letterhead: {
      name: 'Perpustakaan SD Lentera Pustaka',
      tagline: 'Menumbuhkan Budaya Baca Sejak Sekolah Dasar',
      address: 'Jl. Pendidikan Nusantara No. 12, Jakarta',
      npsn: '20109842',
      phone: '(021) 555-0192',
      email: 'perpustakaan@lenterapustaka.sch.id',
      academicYear: '2026/2027',
      semester: 'Ganjil',
      principalName: 'Dra. Hj. Ratna Kusuma, M.Pd.',
      librarianHeadName: 'Siti Rahmawati, S.IP.',
    },
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    categoryName: 'Cerita Anak',
    summaryMetrics: [
      { label: 'Total Sirkulasi', value: '1' },
      { label: 'Total Denda', value: 'Rp 1.500' },
    ],
    generatedAt: new Date(2026, 10, 20),
  });

  assert.equal(model.orientation, 'landscape');
  assert.equal(model.institutionName, 'Perpustakaan SD Lentera Pustaka');
  assert.equal(model.institutionInitials, 'LP');
  assert.ok(model.institutionContactLine.includes('NPSN: 20109842'));
  assert.ok(model.institutionContactLine.includes('Telp: (021) 555-0192'));
  assert.equal(model.headers[0], 'No');
  assert.equal(model.headers[5], 'Kategori Buku');
  assert.equal(model.bodyRows[0][0], '1');
  assert.equal(model.bodyRows[0][8], 'Rp 1.500');
  assert.equal(model.signatureDateLine, 'Jakarta, 20 November 2026');
  assert.ok(model.metadataItems.some((m) => m.label === 'Kategori Buku' && m.value === 'Cerita Anak'));
  assert.ok(model.footerScopeLabel.includes('Kategori: Cerita Anak'));
});

