import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  rows: Array<Record<string, unknown>>
): void {
  if (!rows.length) return;
  const doc = new jsPDF({ orientation: Object.keys(rows[0]).length > 5 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Dicetak pada: ${new Date().toLocaleString('id-ID')}`, 14, 22);

  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => String(r[h] ?? '-')));

  autoTable(doc, {
    startY: 27,
    head: [headers.map((h) => h.replace(/_/g, ' '))],
    body,
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [29, 78, 216] },
  });

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
