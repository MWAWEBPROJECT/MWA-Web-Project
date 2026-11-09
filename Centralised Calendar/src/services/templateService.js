// Builds the admin import template with in-cell dropdowns (data validation). ExcelJS is used only
// to WRITE this template (never to parse untrusted files); uploaded workbooks are still parsed by SheetJS
// and fully re-validated server-side, so the dropdowns are a convenience, not a control.
import { EXPORT_HEADERS, IMPORT_INSTRUCTIONS, templateRows, TEMPLATE_COLUMN_COUNT, PRAYER_NAMES } from '../utils/excelUtils.js';

export const TEMPLATE_LAST_ROW = 501; // header + 500 rows (matches the import cap)

export async function buildImportTemplateWorkbook({sheetName,headers,dataRows,widths,instructions,lists=[],validations=[],lastRow=501,textColumns=[]}){
  if(!Array.isArray(dataRows)||dataRows.length>lastRow-1)throw new Error('The import template supports up to '+(lastRow-1)+' rows. No partial workbook was created.');
  const ExcelJS=(await import('exceljs')).default,wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet(sheetName,{views:[{state:'frozen',ySplit:1}]});
  [headers,...dataRows].forEach(row=>ws.addRow(row));ws.getRow(1).font={bold:true};
  widths.forEach((width,index)=>{ws.getColumn(index+1).width=width;});
  for(const column of textColumns)for(let row=2;row<=lastRow;row++)ws.getCell(row,column).numFmt='@';
  const listSheet=wb.addWorksheet('Lists');lists.forEach(row=>listSheet.addRow(row));listSheet.getRow(1).font={bold:true};
  for(let column=1;column<=Math.max(2,lists[0]?.length||0);column++)listSheet.getColumn(column).width=28;
  for(const validation of validations)for(let row=2;row<=lastRow;row++)ws.getCell(row,validation.col).dataValidation={type:'list',allowBlank:true,formulae:[validation.source],showErrorMessage:true,errorStyle:'warning',errorTitle:'Not in list',error:'Pick a value from the list.'};
  const ins=wb.addWorksheet('Instructions');instructions.forEach(row=>ins.addRow(row));ins.getColumn(1).width=130;ins.getRow(1).font={bold:true,size:14};
  return wb;
}

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
  const names = (list) => list.filter(x => x.active !== false).map(x => String(x.name || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const dNames = names(departments); const vNames = names(venues);

  const widths = [8, 30, 18, 18, 12, 12, 11, 8, 12, 11, 11, 8, 12, 11, 14, 14, 12, 12, 20, 30, 18, 22, 16, 30];
  const lists=[['Booking Types','Venues']];
  for(let i=0;i<Math.max(dNames.length,vNames.length);i++)lists.push([dNames[i]||null,vNames[i]||null]);
  return buildImportTemplateWorkbook({sheetName:'Bookings',headers:EXPORT_HEADERS.slice(0,TEMPLATE_COLUMN_COUNT),dataRows,widths:widths.slice(0,TEMPLATE_COLUMN_COUNT),instructions:IMPORT_INSTRUCTIONS,lists,validations:templateValidations(dNames.length,vNames.length),lastRow:TEMPLATE_LAST_ROW,textColumns:[EXPORT_HEADERS.indexOf('Date')+1]});
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
