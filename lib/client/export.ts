import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LibraryIdentity } from '@/lib/domain/settings-backup-rules';

export function exportToCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToExcel(
  filename: string,
  sheetName: string,
  rows: Array<Record<string, unknown>>
): void {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function exportToPdf(
  filename: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  letterhead?: Partial<LibraryIdentity>
): void {
  if (!rows.length) return;
  const doc = new jsPDF({ orientation: Object.keys(rows[0]).length > 5 ? 'landscape' : 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 14;

  if (letterhead?.name) {
    doc.setFontSize(13);
    doc.setTextColor(30, 36, 51);
    doc.text(letterhead.name.toUpperCase(), 14, cursorY);
    cursorY += 5.5;

    const subLines: string[] = [];
    if (letterhead.address) subLines.push(letterhead.address);
    const contactParts = [
      letterhead.npsn ? `NPSN: ${letterhead.npsn}` : '',
      letterhead.phone ? `Telp: ${letterhead.phone}` : '',
      letterhead.email ? `Email: ${letterhead.email}` : '',
      letterhead.website ? letterhead.website : '',
    ].filter(Boolean);
    if (contactParts.length > 0) subLines.push(contactParts.join(' · '));
    if (letterhead.academicYear || letterhead.semester) {
      subLines.push(
        `Tahun Ajaran ${letterhead.academicYear || '-'} · Semester ${letterhead.semester || '-'}`
      );
    }

    doc.setFontSize(8.5);
    doc.setTextColor(92, 94, 100);
    for (const line of subLines) {
      doc.text(line, 14, cursorY);
      cursorY += 4.2;
    }

    doc.setDrawColor(200, 196, 186);
    doc.line(14, cursorY, pageWidth - 14, cursorY);
    cursorY += 6;
  }

  doc.setFontSize(12);
  doc.setTextColor(30, 36, 51);
  doc.text(title, 14, cursorY);
  cursorY += 5.5;

  doc.setFontSize(8.5);
  doc.setTextColor(110, 112, 118);
  doc.text(`Dicetak pada: ${new Date().toLocaleString('id-ID')}`, 14, cursorY);
  cursorY += 4;

  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => String(r[h] ?? '-')));

  autoTable(doc, {
    startY: cursorY,
    head: [headers.map((h) => h.replace(/_/g, ' '))],
    body,
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [34, 43, 58] },
  });

  if (letterhead?.principalName || letterhead?.librarianHeadName) {
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 20;
    const pageHeight = doc.internal.pageSize.getHeight();
    let signY = finalY + 14;
    if (signY + 26 > pageHeight) {
      doc.addPage();
      signY = 24;
    }
    doc.setFontSize(9);
    doc.setTextColor(30, 36, 51);
    if (letterhead.principalName) {
      doc.text('Mengetahui,', 14, signY);
      doc.text('Kepala Sekolah', 14, signY + 4.5);
      doc.text(letterhead.principalName, 14, signY + 22);
    }
    if (letterhead.librarianHeadName) {
      const rightX = pageWidth - 78;
      doc.text('Penanggung Jawab,', rightX, signY);
      doc.text('Kepala Perpustakaan', rightX, signY + 4.5);
      doc.text(letterhead.librarianHeadName, rightX, signY + 22);
    }
  }

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export async function parseSpreadsheetFile(file: File): Promise<Array<Record<string, unknown>>> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const worksheet = workbook.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json(worksheet) as Array<Record<string, unknown>>;
}
