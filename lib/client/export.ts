import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LibraryIdentity } from '@/lib/domain/settings-backup-rules';
import {
  buildPdfReportDocumentModel,
  type PdfReportSummaryMetric,
} from '@/lib/domain/report-filters';

export interface PdfExportOptions {
  subtitle?: string;
  fromDate?: string;
  toDate?: string;
  categoryName?: string;
  className?: string;
  summaryMetrics?: ReadonlyArray<PdfReportSummaryMetric>;
  generatedAt?: Date;
}

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

export function buildInstitutionalPdfDocument(
  title: string,
  rows: Array<Record<string, unknown>>,
  letterhead?: Partial<LibraryIdentity>,
  options?: PdfExportOptions
): jsPDF {
  const model = buildPdfReportDocumentModel({
    title,
    subtitle: options?.subtitle,
    rows,
    letterhead,
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    categoryName: options?.categoryName,
    className: options?.className,
    summaryMetrics: options?.summaryMetrics,
    generatedAt: options?.generatedAt,
  });

  const doc = new jsPDF({
    orientation: model.orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  let cursorY = 12;

  // --- 1. Official Institutional Letterhead (Kop Surat Perpustakaan) ---
  const badgeSize = 15;
  const badgeX = marginX;
  const badgeY = cursorY + 0.5;

  // Vector institutional crest badge (deep navy + warm coral inner border + monogram)
  doc.setFillColor(34, 43, 58);
  doc.roundedRect(badgeX, badgeY, badgeSize, badgeSize, 2.2, 2.2, 'F');
  doc.setDrawColor(229, 107, 99);
  doc.setLineWidth(0.45);
  doc.roundedRect(badgeX + 1.1, badgeY + 1.1, badgeSize - 2.2, badgeSize - 2.2, 1.4, 1.4, 'S');
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(250, 249, 245);
  doc.text(model.institutionInitials, badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 1.2, {
    align: 'center',
  });

  const textX = marginX + badgeSize + 4.5;
  const maxHeaderTextWidth = contentWidth - badgeSize - 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(229, 107, 99);
  doc.text('SISTEM INFORMASI PERPUSTAKAAN SEKOLAH', textX, cursorY + 2.8);

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 36, 51);
  const wrappedInstName = doc.splitTextToSize(
    model.institutionName.toUpperCase(),
    maxHeaderTextWidth
  );
  doc.text(wrappedInstName, textX, cursorY + 8.2);
  let headerBottomY = cursorY + 8.2 + (wrappedInstName.length - 1) * 5.2;

  if (model.institutionTagline) {
    headerBottomY += 4;
    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(92, 94, 100);
    doc.text(model.institutionTagline, textX, headerBottomY);
  }

  if (model.institutionAddress) {
    headerBottomY += 3.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(74, 73, 69);
    doc.text(model.institutionAddress, textX, headerBottomY);
  }

  if (model.institutionContactLine) {
    headerBottomY += 3.6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(102, 104, 110);
    doc.text(model.institutionContactLine, textX, headerBottomY);
  }

  // Formal Double Horizontal Rule (Kop Surat)
  const ruleY = Math.max(headerBottomY + 2.6, badgeY + badgeSize + 2.5);
  doc.setDrawColor(34, 43, 58);
  doc.setLineWidth(0.75);
  doc.line(marginX, ruleY, pageWidth - marginX, ruleY);
  doc.setDrawColor(229, 107, 99);
  doc.setLineWidth(0.28);
  doc.line(marginX, ruleY + 1.15, pageWidth - marginX, ruleY + 1.15);

  cursorY = ruleY + 6.5;

  // --- 2. Report Title & Subtitle ---
  doc.setFont('times', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(30, 36, 51);
  doc.text(model.reportTitle, pageWidth / 2, cursorY, { align: 'center' });
  cursorY += 4.5;

  if (model.reportSubtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(92, 94, 100);
    const wrappedSub = doc.splitTextToSize(model.reportSubtitle, contentWidth - 12);
    doc.text(wrappedSub, pageWidth / 2, cursorY, { align: 'center' });
    cursorY += wrappedSub.length * 3.8 + 1.5;
  } else {
    cursorY += 1.5;
  }

  // --- 3. Structured Metadata Box (Periode, Kategori Buku, Rombel, dsb.) ---
  const metaCols = model.orientation === 'landscape' ? 3 : 2;
  const metaRowsCount = Math.ceil(model.metadataItems.length / metaCols);
  const metaBoxHeight = metaRowsCount * 6.4 + 4;
  doc.setFillColor(250, 249, 245);
  doc.setDrawColor(226, 223, 215);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginX, cursorY, contentWidth, metaBoxHeight, 1.8, 1.8, 'FD');

  const metaColWidth = contentWidth / metaCols;
  model.metadataItems.forEach((item, index) => {
    const colIdx = index % metaCols;
    const rowIdx = Math.floor(index / metaCols);
    const cellX = marginX + colIdx * metaColWidth + 3.5;
    const cellY = cursorY + 4.8 + rowIdx * 6.4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(123, 125, 130);
    doc.text(`${item.label}:`, cellX, cellY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(30, 36, 51);
    const labelWidth = doc.getTextWidth(`${item.label}: `);
    const availableValWidth = Math.max(18, metaColWidth - labelWidth - 6);
    const clippedVal = doc.splitTextToSize(item.value, availableValWidth)[0] || item.value;
    doc.text(clippedVal, cellX + labelWidth + 1.2, cellY);
  });

  cursorY += metaBoxHeight + 3.8;

  // --- 4. Circulation Summary Strip (when provided) ---
  if (model.summaryMetrics.length > 0) {
    const count = model.summaryMetrics.length;
    const gap = 2.5;
    const cardWidth = (contentWidth - gap * (count - 1)) / count;
    const cardHeight = 12.5;

    model.summaryMetrics.forEach((metric, idx) => {
      const x = marginX + idx * (cardWidth + gap);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(231, 228, 220);
      doc.setLineWidth(0.28);
      doc.roundedRect(x, cursorY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(110, 112, 118);
      doc.text(metric.label, x + 3, cursorY + 4.2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      if (metric.tone === 'danger') {
        doc.setTextColor(201, 74, 67);
      } else if (metric.tone === 'success') {
        doc.setTextColor(21, 128, 61);
      } else if (metric.tone === 'warning') {
        doc.setTextColor(180, 83, 9);
      } else if (metric.tone === 'accent') {
        doc.setTextColor(229, 107, 99);
      } else {
        doc.setTextColor(30, 36, 51);
      }
      doc.text(metric.value, x + 3, cursorY + 9.8);
    });

    cursorY += cardHeight + 4;
  }

  // --- 5. Styled AutoTable ---
  const columnStyles: Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }> = {
    0: { halign: 'center', cellWidth: 9 },
  };
  model.columnAlignments.forEach((align, index) => {
    if (index === 0) return;
    columnStyles[index] = { halign: align };
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { top: 20, right: marginX, bottom: 18, left: marginX },
    head: [model.headers],
    body: model.bodyRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: model.orientation === 'landscape' ? 7.4 : 8,
      cellPadding: { top: 2.2, right: 2.4, bottom: 2.2, left: 2.4 },
      textColor: [30, 36, 51],
      lineColor: [231, 228, 220],
      lineWidth: 0.2,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [34, 43, 58],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: model.orientation === 'landscape' ? 7.4 : 8,
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [250, 249, 245],
    },
    columnStyles,
    didDrawPage: (data) => {
      // Compact running header on pages 2+
      if (data.pageNumber > 1) {
        doc.setFont('times', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(30, 36, 51);
        doc.text(model.institutionName, marginX, 11);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(110, 112, 118);
        doc.text(model.reportTitle, pageWidth - marginX, 11, { align: 'right' });

        doc.setDrawColor(215, 211, 202);
        doc.setLineWidth(0.25);
        doc.line(marginX, 13.5, pageWidth - marginX, 13.5);
      }
    },
  });

  // --- 6. Official Signature Block (Mengetahui & Penanggung Jawab) ---
  if (model.principalName || model.librarianHeadName) {
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY + 20;
    let signY = finalY + 12;
    const blockHeight = 32;

    if (signY + blockHeight > pageHeight - 16) {
      doc.addPage();
      signY = 24;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 36, 51);

    const leftX = marginX + 10;
    const rightColCenter = pageWidth - marginX - 38;

    if (model.principalName) {
      doc.text('Mengetahui,', leftX, signY);
      doc.text('Kepala Sekolah', leftX, signY + 4.5);
      doc.setFont('helvetica', 'bold');
      doc.text(model.principalName, leftX, signY + 22);
      const nameWidth = Math.max(44, doc.getTextWidth(model.principalName));
      doc.setDrawColor(30, 36, 51);
      doc.setLineWidth(0.25);
      doc.line(leftX, signY + 23.2, leftX + nameWidth, signY + 23.2);
    }

    if (model.librarianHeadName) {
      doc.setFont('helvetica', 'normal');
      doc.text(model.signatureDateLine, rightColCenter, signY, { align: 'center' });
      doc.text('Kepala Perpustakaan', rightColCenter, signY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.text(model.librarianHeadName, rightColCenter, signY + 22, { align: 'center' });
      const nameWidth = Math.max(44, doc.getTextWidth(model.librarianHeadName));
      doc.setDrawColor(30, 36, 51);
      doc.setLineWidth(0.25);
      doc.line(
        rightColCenter - nameWidth / 2,
        signY + 23.2,
        rightColCenter + nameWidth / 2,
        signY + 23.2
      );
    }
  }

  // --- 7. Page Footers with Exact Total Page Count (Halaman X dari Y) ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerLineY = pageHeight - 12;
    doc.setDrawColor(220, 217, 209);
    doc.setLineWidth(0.25);
    doc.line(marginX, footerLineY, pageWidth - marginX, footerLineY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(123, 125, 130);
    doc.text(model.footerScopeLabel, marginX, footerLineY + 4.2);
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - marginX, footerLineY + 4.2, {
      align: 'right',
    });
  }

  return doc;
}

export function exportToPdf(
  filename: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  letterhead?: Partial<LibraryIdentity>,
  options?: PdfExportOptions
): string | null {
  if (!rows.length) return null;
  const doc = buildInstitutionalPdfDocument(title, rows, letterhead, options);
  const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeFilename);
  return safeFilename;
}

export async function parseSpreadsheetFile(file: File): Promise<Array<Record<string, unknown>>> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const worksheet = workbook.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json(worksheet) as Array<Record<string, unknown>>;
}
