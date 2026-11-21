import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstitutionalPdfDocument } from './export';

test('buildInstitutionalPdfDocument generates a valid PDF containing institutional header, category filter, and circulation table', () => {
  const doc = buildInstitutionalPdfDocument(
    'Laporan Sirkulasi (Pinjam & Kembali) — Kategori: Cerita Anak',
    [
      {
        No_Transaksi: 'PJM-2026-0001',
        Anggota: 'Bima Pratama Putra',
        Rombel_Kelas: 'Kelas 5A',
        Judul_Buku: 'Petualangan Kancil di Hutan',
        Kategori_Buku: 'Cerita Anak',
        Kode_Eksemplar: 'LP-2026-0001',
        Tanggal_Pinjam: '2026-11-01',
        Jatuh_Tempo: '2026-11-08',
        Tanggal_Kembali: '2026-11-07',
        Status: 'Dikembalikan',
        Denda: 0,
      },
      {
        No_Transaksi: 'PJM-2026-0002',
        Anggota: 'Alya Putri Azzahra',
        Rombel_Kelas: 'Kelas 2B',
        Judul_Buku: 'Dongeng Nusantara Bergambar',
        Kategori_Buku: 'Cerita Anak',
        Kode_Eksemplar: 'LP-2026-0005',
        Tanggal_Pinjam: '2026-11-02',
        Jatuh_Tempo: '2026-11-09',
        Tanggal_Kembali: '-',
        Status: 'Terlambat',
        Denda: 2500,
      },
    ],
    {
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
    {
      subtitle: 'Menampilkan transaksi sirkulasi khusus kategori buku Cerita Anak.',
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      categoryName: 'Cerita Anak',
      summaryMetrics: [
        { label: 'Total Sirkulasi', value: '2 item', tone: 'neutral' },
        { label: 'Dikembalikan', value: '1', tone: 'success' },
        { label: 'Terlambat', value: '1', tone: 'danger' },
        { label: 'Total Denda', value: 'Rp 2.500', tone: 'warning' },
      ],
      generatedAt: new Date(2026, 10, 20),
    }
  );

  const rawPdf = doc.output();
  assert.ok(rawPdf.startsWith('%PDF-'), 'Expected valid PDF header');
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(rawPdf.includes('PERPUSTAKAAN SD LENTERA PUSTAKA'), 'Expected uppercase institution header');
  assert.ok(rawPdf.includes('NPSN: 20109842'), 'Expected NPSN in letterhead');
  assert.ok(rawPdf.includes('Cerita Anak'), 'Expected book category filter in PDF');
  assert.ok(rawPdf.includes('Petualangan Kancil di Hutan'), 'Expected book title in table');
  assert.ok(rawPdf.includes('Rp 2.500'), 'Expected formatted Rupiah fine');
  assert.ok(rawPdf.includes('Halaman 1 dari 1'), 'Expected page count footer');
  assert.ok(rawPdf.includes('Kepala Sekolah'), 'Expected principal signature block');
  assert.ok(rawPdf.includes('Kepala Perpustakaan'), 'Expected librarian head signature block');
});
