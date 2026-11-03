import test from 'node:test';
import assert from 'node:assert/strict';
import {collectResponses,responseWorkbook,MAX_EXPORT_RESPONSES} from './registration-exports.mjs';
import {filterResponses,responseQuestions} from './registration-response-model.mjs';
const asOf='2026-11-03T02:30:00.000Z';
const name={id:'name',type:'text',label:'Full name',required:true};
const consent={id:'consent',type:'consent',label:'Agreement',required:true,terms:'Original terms'};
const form={id:'synthetic-form',title:'Community form',revision:2,fields:[name,consent]};
const row={id:'one',reference:'MWA-R-ONE',createdAt:'2026-11-02T22:15:00.000Z',formTitle:'Original form title',revision:1,eventId:'event-one',fields:[name,consent],answers:{name:'=HYPERLINK("https://example.invalid")',consent:true}};
test('response export fetches every page with one cutoff and deduplicates overlapping records',async()=>{
 const calls=[];
 const rows=await collectResponses(async path=>{
  calls.push(new URL(path,'https://example.invalid'));
  return calls.length===1?{items:[row],next:'next-page'}:{items:[row,{...row,id:'two'}],next:null};
 },form.id,{asOf});
 assert.equal(rows.length,2);
 assert.equal(calls[0].searchParams.get('after'),'');
 assert.equal(calls[1].searchParams.get('after'),'next-page');
 assert.ok(calls.every(call=>call.searchParams.get('asOf')===asOf));
});
test('failure, cancellation, page loops and export limits never return partial rows',async()=>{
 await assert.rejects(collectResponses(async()=>{throw Error('Network failed');},form.id),/Network failed/);
 await assert.rejects(collectResponses(async()=>({items:[],next:'repeat'}),form.id),/pages changed/);
 let cancelled=false;
 await assert.rejects(collectResponses(async()=>{cancelled=true;return {items:[row],next:null};},form.id,{cancelled:()=>cancelled}),/cancelled/);
 await assert.rejects(collectResponses(async()=>({items:Array.from({length:MAX_EXPORT_RESPONSES+1},(_,id)=>({...row,id})),next:null}),form.id),/cannot return partial/);
});
test('Excel round trip preserves historical questions, literal text, numbers, dates and consent terms',async()=>{
 const fields=[
  {...name,label:'Preferred name'},
  {...consent,terms:'Changed terms'},
  {id:'phone',label:'Phone',type:'phone'},
  {id:'age',label:'Age',type:'number'},
  {id:'date',label:'Preferred date',type:'date'},
  {id:'choices',label:'Interests',type:'checkboxes',options:['One','Two']},
 ];
 const second={...row,id:'two',reference:'MWA-R-TWO',revision:2,editRevision:1,editedAt:asOf,fields,answers:{name:'Visitor',consent:true,phone:'0412345678',age:'0',date:'2027-02-02',choices:['One','Two']}};
 const blob=await responseWorkbook(form,[row,second],asOf);
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await blob.arrayBuffer());
 const sheet=workbook.getWorksheet('Responses'),questions=workbook.getWorksheet('Questions');
 assert.equal(sheet.rowCount,3);
 assert.equal(sheet.getCell('B2').value.toISOString(),'2026-11-03T00:00:00.000Z');
 assert.equal(sheet.getCell('C2').value,'09:15:00');
 assert.equal(sheet.getCell('E2').value,'Original form title');
 assert.equal(sheet.getCell('F2').value,'event-one');
 assert.equal(sheet.getCell('I2').value,row.answers.name);
 assert.equal(sheet.getCell('I2').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('J2').value,'Agreed');
 assert.equal(sheet.getCell('K3').value,'Visitor');
 assert.equal(sheet.getCell('L3').value,'Agreed');
 assert.equal(sheet.getCell('M3').value,'0412345678');
 assert.equal(sheet.getCell('N3').value,0);
 assert.equal(sheet.getCell('O3').value.toISOString(),'2027-02-02T00:00:00.000Z');
 assert.equal(sheet.getCell('P3').value,'One\nTwo');
 assert.equal(sheet.getCell('G3').value,1);
 assert.equal(sheet.getCell('H3').value,'2026-11-03 13:30:00');
 assert.equal(questions.getCell('H3').value,'Original terms');
 assert.equal(questions.getCell('H5').value,'Changed terms');
 assert.equal(sheet.views[0].state,'frozen');
 assert.equal(workbook.getWorksheet('Export summary').getCell('B4').value,2);
});
test('empty export includes current questions and cancellation prevents workbook delivery',async()=>{
 const blob=await responseWorkbook(form,[],asOf);
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await blob.arrayBuffer());
 assert.equal(workbook.getWorksheet('Responses').rowCount,1);
 assert.equal(workbook.getWorksheet('Questions').rowCount,3);
 await assert.rejects(responseWorkbook(form,[row],asOf,{cancelled:()=>true}),/cancelled/);
});
test('filters search saved field values case-insensitively without changing newest-first order',()=>{
 const choices={id:'choices',type:'checkboxes',label:'Interests',options:['Gardening','Cooking']};
 const rows=[
  {...row,id:'newest',fields:[name,choices],answers:{name:'Sam',choices:['Cooking']}},
  {...row,id:'middle',fields:[{...name,label:'Preferred name'},choices],answers:{name:'SAMIRA',choices:['Gardening']}},
  {...row,id:'oldest',fields:[name,choices],answers:{name:'Someone',choices:['Cooking']}},
 ];
 assert.deepEqual(filterResponses(rows,{field:'name',query:' sam '}).map(row=>row.id),['newest','middle']);
 assert.deepEqual(filterResponses(rows,{field:'choices',query:'COOK'}).map(row=>row.id),['newest','oldest']);
 assert.deepEqual(filterResponses(rows,{query:'garden'}).map(row=>row.id),['middle']);
 assert.equal(filterResponses(rows,{query:'   '}),rows);
 assert.deepEqual(filterResponses(rows,{field:'name',query:'cooking'}),[]);
 assert.equal(responseQuestions(form,rows).find(question=>question.id==='name').label,'Full name / Preferred name');
});
test('filtered Excel contains every matching row, including matches beyond the first display page',async()=>{
 const source=Array.from({length:125},(_,index)=>({...row,id:String(index),reference:'REF-'+index,answers:{...row.answers,name:index%2?'Other':'Visitor'}}));
 const filter={field:'name',label:'Full name',query:'Visitor'},matches=filterResponses(source,filter);
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await (await responseWorkbook(form,matches,asOf,{filter})).arrayBuffer());
 assert.equal(workbook.getWorksheet('Responses').rowCount,64);
 assert.equal(workbook.getWorksheet('Responses').getCell('A64').value,'REF-124');
 assert.match(workbook.getWorksheet('Export summary').getCell('B7').value,/Full name contains: Visitor/);
});
