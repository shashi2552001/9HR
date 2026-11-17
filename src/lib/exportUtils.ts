import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportRowsToCsv(
  filename: string,
  columns: string[],
  rows: Record<string, string | number>[],
): void {
  const escape = (val: unknown) => {
    const str = String(val ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map(escape).join(',');
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${filename}.csv`);
}

export function exportRowsToExcel(
  filename: string,
  sheetName: string,
  columns: string[],
  rows: Record<string, string | number>[],
): void {
  const ordered = rows.map((r) => {
    const obj: Record<string, string | number> = {};
    for (const c of columns) obj[c] = r[c] ?? '';
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(ordered, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportRowsToPdf(
  filename: string,
  title: string,
  columns: string[],
  rows: Record<string, string | number>[],
): void {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.setTextColor(16, 24, 32);
  doc.text('9HR India Private Limited', 14, 15);
  doc.setFontSize(11);
  doc.setTextColor(8, 99, 232);
  doc.text(title, 14, 22);
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')} · Confidential Enterprise Report`, 14, 28);

  autoTable(doc, {
    startY: 33,
    head: [columns],
    body: rows.map((r) => columns.map((c) => String(r[c] ?? ''))),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [8, 99, 232], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${filename}.pdf`);
}

export function downloadCandidateImportTemplate(): void {
  const sample = [
    {
      'Full Name': 'Karan Verma',
      Email: 'karan.verma@example.in',
      Mobile: '+91 98100 11223',
      Skills: 'React, TypeScript, Node.js',
      Experience: '4.5',
      currentCompany: 'Tech Mahindra',
      expectedSalary: '₹20 LPA',
      source: 'LinkedIn',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
  XLSX.writeFile(wb, '9HR_Candidate_Import_Template.xlsx');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
