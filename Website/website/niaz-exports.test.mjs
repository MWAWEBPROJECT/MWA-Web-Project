import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const result=await build({entryPoints:[fileURLToPath(new URL('./niaz-client.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'offline-auth',setup(b){
 b.onResolve({filter:/^@calendar\/firebase\/firebase\.js$/},()=>({path:'auth',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth={currentUser:null};',loader:'js'}));
 b.onResolve({filter:/^@calendar\//},args=>({path:fileURLToPath(new URL('../../Centralised Calendar/src/'+args.path.slice(10),import.meta.url))}));
}}]});
const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {parseCSV,workbook,readImport,importColumns,importHeaders,importMapping,mapImportRows,importTemplate}=module.exports;
test('Legacy CSV parses quoted newlines, commas and doubled quotes without losing columns',()=>{
 assert.deepEqual(parseCSV('\uFEFFname,email,notes\r\n"Example, Person",demo@example.org,"Line 1\nLine ""2"""\r\n'),{headers:['name','email','notes'],rows:[['Example, Person','demo@example.org','Line 1\nLine "2"']]});
 assert.throws(()=>parseCSV('name,email\n"unclosed'),/Unclosed/);
 assert.throws(()=>parseCSV('name,email\nextra,columns,here'),/column count/);
});
test('Niaz template mirrors shared Bookings builder sheets, headers, instructions, dropdowns and day-first text dates',async()=>{
 const blob=await importTemplate(),ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await blob.arrayBuffer());
 assert.deepEqual(book.worksheets.map(sheet=>sheet.name),['Niaz Sponsors','Lists','Instructions']);
 const sheet=book.getWorksheet('Niaz Sponsors');
 assert.deepEqual(sheet.getRow(1).values.slice(1),importHeaders);
 assert.equal(sheet.views[0].state,'frozen');assert.equal(sheet.getRow(1).font.bold,true);
 assert.equal(sheet.getCell('D501').numFmt,'@');assert.equal(sheet.getCell('F501').dataValidation.type,'list');
 assert.equal(book.getWorksheet('Instructions').getRow(1).font.size,14);assert.equal(book.getWorksheet('Instructions').getColumn(1).width,130);
 assert.ok(book.getWorksheet('Instructions').getRow(3).getCell(1).value.includes('Required:'));
 const data=await readImport({name:'mwa-niaz-import-template.xlsx',size:blob.size,arrayBuffer:()=>blob.arrayBuffer()});
 const rows=mapImportRows(data,importMapping(data.headers));assert.equal(rows.length,3);assert.equal(rows[0].eventDate,'2027-01-11');
 assert.deepEqual(rows.map(row=>row.type),['one_time','annual','permanent']);assert.equal(rows[0].publicConsent,'false');assert.equal(rows[2].memberId,'');
 const csv=parseCSV('Name,Email,Mobile,Date,Event Id,Sponsorship Type,Series Id,Role,Public Consent,In-kind Provision,Notes,Member Id\nExample,demo@example.org,,11/01/2027,event1,one_time,,joint,false,,,\n');
 assert.equal(mapImportRows(csv,importMapping(csv.headers))[0].eventDate,'2027-01-11');
});
test('Standard XLSX template retains every mapping column and uses literal formula-like text',async()=>{
 const row={...Object.fromEntries(importColumns.map(key=>[key,''])),name:'=SUM(1,2)',email:'demo@example.org',eventDate:'2027-01-11',type:'one_time',role:'joint',publicConsent:false};
 const blob=await workbook({'Import template':[row],'Event coverage & history':[{name:'Synthetic',status:'proposed'}]});
 const parsed=await readImport({name:'template.xlsx',size:blob.size,arrayBuffer:()=>blob.arrayBuffer()});
 assert.deepEqual(parsed.headers,importColumns);
 assert.equal(parsed.rows[0][0],'=SUM(1,2)');assert.equal(mapImportRows(parsed,importMapping(parsed.headers))[0].publicConsent,'false');
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await blob.arrayBuffer());
 assert.equal(book.getWorksheet('Import template').getCell('A2').type,3);
 assert.equal(book.worksheets.length,2);assert.equal(book.worksheets[0].views[0].state,'frozen');
});
