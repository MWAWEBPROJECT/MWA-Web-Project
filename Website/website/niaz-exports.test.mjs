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
test('Sponsor Directory template matches Create Sponsor and reads a blank 500-row workbook',async()=>{
 const blob=await importTemplate(),ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await blob.arrayBuffer());
 assert.deepEqual(book.worksheets.map(sheet=>sheet.name),['Niaz Sponsors','Lists','Instructions']);
 const sheet=book.getWorksheet('Niaz Sponsors');
 assert.deepEqual(sheet.getRow(1).values.slice(1),importHeaders);
 assert.equal(sheet.views[0].state,'frozen');assert.equal(sheet.getRow(1).font.bold,true);
 assert.equal(sheet.getCell('C501').numFmt,'@');assert.equal(sheet.getCell('F501').dataValidation.type,'list');
 assert.equal(book.getWorksheet('Instructions').getRow(1).font.size,14);assert.equal(book.getWorksheet('Instructions').getColumn(1).width,130);
 assert.ok(book.getWorksheet('Instructions').getRow(3).getCell(1).value.includes('Name is required'));
 const data=await readImport({name:'mwa-niaz-import-template.xlsx',size:blob.size,arrayBuffer:()=>blob.arrayBuffer()});
 assert.equal(data.rows.length,0);
 const csv=parseCSV('Name,Email,Mobile,Internal Notes,Public Consent,Active\nExample,demo@example.org,0412345678,Welcome,yes,no\n');
 assert.deepEqual(mapImportRows(csv,importMapping(csv.headers))[0],{name:'Example',email:'demo@example.org',phone:'0412345678',notes:'Welcome',publicConsent:true,active:false});
});
test('Standard XLSX template retains every mapping column and uses literal formula-like text',async()=>{
 const row={...Object.fromEntries(importColumns.map(key=>[key,''])),name:'=SUM(1,2)',email:'demo@example.org',publicConsent:false};
 const blob=await workbook({'Import template':[row],'Event coverage & history':[{name:'Synthetic',status:'proposed'}]});
 const parsed=await readImport({name:'template.xlsx',size:blob.size,arrayBuffer:()=>blob.arrayBuffer()});
 assert.deepEqual(parsed.headers,importColumns);
 assert.equal(parsed.rows[0][0],'=SUM(1,2)');assert.equal(mapImportRows(parsed,importMapping(parsed.headers))[0].publicConsent,false);
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await blob.arrayBuffer());
 assert.equal(book.getWorksheet('Import template').getCell('A2').type,3);
 assert.equal(book.worksheets.length,2);assert.equal(book.worksheets[0].views[0].state,'frozen');
});
