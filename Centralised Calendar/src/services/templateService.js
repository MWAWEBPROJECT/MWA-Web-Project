// Builds the admin import template with in-cell dropdowns (data validation). ExcelJS is used only
// to WRITE this template (never to parse untrusted files); uploaded workbooks are still parsed by SheetJS
// and fully re-validated server-side, so the dropdowns are a convenience, not a control.
import { EXPORT_HEADERS, IMPORT_INSTRUCTIONS, templateRows, TEMPLATE_COLUMN_COUNT, PRAYER_NAMES } from '../utils/excelUtils.js';

export const TEMPLATE_LAST_ROW = 501; // header + 500 rows (matches the import cap)

/** Pure description of the dropdown columns (1-based column index -> list ref), testable without ExcelJS. */
export function templateValidations(deptCount, venueCount) {
  const col = (name) => EXPORT_HEADERS.indexOf(name) + 1;
  const prayers = `"${PRAYER_NAMES.join(',')}"`;
  return [
    { col: col('Date Basis'), source: '"Gregorian,Hijri"' },
    { col: col('Booking Type'), source: `Lists!$A$2:$A$${Math.max(2, deptCount + 1)}` },
    { col: col('Venue'), source: `Lists!$B$2:$B$${Math.max(2, venueCount + 1)}` },
    { col: col('Start Type'), source: '"Fixed,Variable"' },
    { col: col('Start Prayer'), source: prayers },
    { col: col('End Type'), source: '"Fixed,Variable"' },
    { col: col('End Prayer'), source: prayers },
    { col: col('Status'), source: '"confirmed,pending"' },
    { col: col('Visibility'), source: '"public,private"' }
  ];
}

export async function buildTemplateWorkbook({ departments = [], venues = [], dataRows = templateRows().slice(1) }) {
  if (!Array.isArray(dataRows) || dataRows.length > TEMPLATE_LAST_ROW - 1) {
    throw new Error('The import template supports up to 500 event rows. No partial workbook was created.');
  }
  const ExcelJS = (await import('exceljs')).default;
  const names = (list) => list.filter(x => x.active !== false).map(x => String(x.name || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const dNames = names(departments); const vNames = names(venues);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bookings', { views: [{ state: 'frozen', ySplit: 1 }] });
  const rows = [EXPORT_HEADERS.slice(0, TEMPLATE_COLUMN_COUNT), ...dataRows];
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  const widths = [8, 30, 18, 18, 12, 12, 11, 8, 12, 11, 11, 8, 12, 11, 14, 14, 12, 12, 20, 30, 18, 22, 16, 30];
  widths.slice(0, TEMPLATE_COLUMN_COUNT).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // Dates are text so Excel can't reinterpret DD/MM/YYYY (and Hijri dates are not Gregorian dates at all).
  const dateCol = EXPORT_HEADERS.indexOf('Date') + 1;
  for (let r = 2; r <= TEMPLATE_LAST_ROW; r += 1) ws.getCell(r, dateCol).numFmt = '@';

  const lists = wb.addWorksheet('Lists');
  lists.addRow(['Booking Types', 'Venues']);
  for (let i = 0; i < Math.max(dNames.length, vNames.length); i += 1) lists.addRow([dNames[i] || null, vNames[i] || null]);
  lists.getRow(1).font = { bold: true };
  lists.getColumn(1).width = 28; lists.getColumn(2).width = 28;

  for (const v of templateValidations(dNames.length, vNames.length)) {
    for (let r = 2; r <= TEMPLATE_LAST_ROW; r += 1) {
      ws.getCell(r, v.col).dataValidation = {
        type: 'list', allowBlank: true, formulae: [v.source], showErrorMessage: true,
        errorStyle: 'warning', errorTitle: 'Not in list', error: 'Pick a value from the list.'
      };
    }
  }

  const ins = wb.addWorksheet('Instructions');
  IMPORT_INSTRUCTIONS.forEach(r => ins.addRow(r));
  ins.getColumn(1).width = 130;
  ins.getRow(1).font = { bold: true, size: 14 };
  return wb;
}

export async function downloadTemplateXlsx({ departments, venues }) {
  const wb = await buildTemplateWorkbook({ departments, venues });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mwa-bookings-import-template.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
