import test from 'node:test';
import assert from 'node:assert/strict';
import {collectResponses,responseWorkbook,insightsWorkbook,mappedAnswersWorkbook,mappedAnswersContent,mappedAnswersPdf,cohortHeatmapWorkbook,cohortHeatmapContent,MAX_EXPORT_RESPONSES,insightsPdfBlocks,paginateInsightsPdf} from './registration-exports.mjs';
import {filterResponses,responseQuestions,responseName} from './registration-response-model.mjs';
import {INSIGHTS_PROVENANCE,insightsExportFilter,insightsPdfMetricRows,yearOverYear} from './insights-provenance.mjs';
const asOf='2026-11-03T02:30:00.000Z';
const name={id:'name',type:'text',label:'Full name',required:true};
const consent={id:'consent',type:'consent',label:'Agreement',required:true,terms:'Original terms'};
const form={id:'synthetic-form',title:'Community form',revision:2,fields:[name,consent]};
const row={id:'one',reference:'MWA-R-ONE',createdAt:'2026-11-02T22:15:00.000Z',formTitle:'Original form title',revision:1,eventId:'event-one',fields:[name,consent],answers:{name:'=HYPERLINK("https://example.invalid")',consent:true}};
test('response summaries use the saved name question and clearly identify missing names',()=>{
 assert.equal(responseName({...row,answers:{name:'  Synthetic Name  '}}),'Synthetic Name');
 assert.equal(responseName({...row,fields:[{id:'custom',type:'text',label:'Full name'}],answers:{custom:'Custom Name'}}),'Custom Name');
 assert.equal(responseName({...row,answers:{name:''}}),'Name not provided');
 assert.equal(responseName({...row,fields:[{id:'other',type:'text',label:'Programme name'}],answers:{other:'Not a person'}}),'Name not provided');
});
test('mapped-answer workbook carries aggregate counts and formula-safe labels without personal data',async()=>{
 const report={concept:'meal',generatedAt:asOf,filters:{from:'2026-01-01',to:'2026-11-01',basis:'event',formId:'',eventFiltered:true,searchUsed:false},coverage:{indexed:7,unavailableEvent:1,staleSource:0,unreviewed:1,unmapped:1,conflicting:0,unsupported:1},notice:'Indexed coverage is incomplete; multiple selections can exceed 100%.',groups:[{label:'Meal',type:'checkboxes',eligible:3,answered:2,missing:1,invalid:0,options:[{label:'=1+1',count:2},{label:'Other',count:1}]},{label:'Size',type:'number',eligible:1,answered:1,missing:0,invalid:0,min:4,max:4,mean:4}]};
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await (await mappedAnswersWorkbook(report)).arrayBuffer());
 assert.equal(book.getWorksheet('Definitions').getCell('D2').value,3);assert.equal(book.getWorksheet('Definitions').getCell('E2').value,2);assert.equal(book.getWorksheet('Definitions').getCell('J3').value,4);
 assert.equal(book.getWorksheet('Choice counts').getCell('B2').value,'=1+1');assert.equal(book.getWorksheet('Choice counts').getCell('B2').type,ExcelJS.ValueType.String);assert.equal(book.getWorksheet('Choice counts').getCell('C3').value,1);assert.equal(book.getWorksheet('Choice counts').getCell('E3').value,0.5);
 assert.match(JSON.stringify(book.model),/Indexed submissions: 7/);assert.doesNotMatch(JSON.stringify(book.model),/email|digest|originalAnswers|responseId/i);
 const content=mappedAnswersContent(report);assert.match(content.header.join(' '),/current calendar event date/);assert.match(content.blocks[0].join(' '),/percentages may total more than 100%/);
 await assert.rejects(mappedAnswersWorkbook(report,{cancelled:()=>true}),/cancelled/);
 const empty=new ExcelJS.Workbook();await empty.xlsx.load(await (await mappedAnswersWorkbook({...report,groups:[]})).arrayBuffer());assert.equal(empty.getWorksheet('Definitions').rowCount,1);
 const huge={...report,groups:Array.from({length:2501},()=>({...report.groups[1],label:'Long '.repeat(40)}))};
 await assert.rejects(mappedAnswersPdf(huge),/exceeds 5,000 metric lines/);
});
test('cross-tab exports preserve same-response counts, denominators and filters',async()=>{
 const report={concept:'meal',concept2:'time',generatedAt:asOf,filters:{from:'2026-01-01',to:'2026-11-01',basis:'submission',categories:['education'],bookingType:'community',series:''},coverage:{indexed:4,unavailableEvent:0,staleSource:0,unreviewed:0,unmapped:0,conflicting:0,unsupported:0},notice:'Same submission only; multi-select cells can overlap.',groups:[],crossTabs:[{definitions:[{label:'Meal',type:'checkboxes',options:['A','B']},{label:'Time',type:'radio',options:['X','Y']}],eligible:4,answered:2,missing:1,invalid:1,counts:[[1,1],[1,0]]}]};
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await (await mappedAnswersWorkbook(report)).arrayBuffer());
 const sheet=book.getWorksheet('Cross-tab cells');assert.equal(sheet.rowCount,5);assert.equal(sheet.getCell('F2').value,1);assert.equal(sheet.getCell('G2').value,2);assert.equal(sheet.getCell('H2').value,0.5);
 const content=mappedAnswersContent(report);assert.match(content.header.join(' '),/education/);assert.match(content.blocks[0].join(' '),/Denominator: 2/);
 assert.throws(()=>mappedAnswersContent({...report,crossTabs:[{...report.crossTabs[0],counts:[[1]]}]}),/invalid metrics/);
});
test('cohort workbook exports counts and exact scope without respondent details',async()=>{
 const report={generatedAt:asOf,historyFrom:'2025-02-01',from:'2026-03-01',to:'2027-12-31',filters:{formId:'form-one',eventId:'event-one',categories:['education'],bookingType:'community',series:''},coverage:{indexed:4,unresolved:1,unmapped:0,staleIndex:0,unavailable:0},notice:'Incomplete history; not attendance.',years:['2026','2027'],rows:[{cohortYear:'2025',counts:[2,1]}],items:[{personId:'PRIVATE-PERSON',names:['PRIVATE NAME']}]};
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(await (await cohortHeatmapWorkbook(report)).arrayBuffer());
 assert.deepEqual(book.getWorksheet('Cohorts').getRow(2).values.slice(1),['2025',2,1]);assert.equal(book.getWorksheet('Cohorts').getCell('B1').value,'2026 (partial)');
 const text=JSON.stringify(book.model);assert.match(text,/education/);assert.match(text,/event-one/);assert.doesNotMatch(text,/PRIVATE-PERSON|PRIVATE NAME/);assert.match(cohortHeatmapContent(report).header.join(' '),/unresolved: 1/);
 assert.throws(()=>cohortHeatmapContent({...report,rows:[{cohortYear:'2025',counts:[1]}]}),/incomplete/);
});
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
test('scoped detail workbook keeps cross-form references and saved consent, without private event IDs',async()=>{
 const first={...row,formId:'form-one',eventId:'',purpose:'Original purpose',originalAnswers:{name:'PRIVATE-ORIGINAL'},digest:'PRIVATE-DIGEST'};
 const second={...row,id:'two',formId:'form-two',reference:'MWA-R-TWO',eventId:'',answers:{name:'Other',consent:true}};
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await (await responseWorkbook(form,[first,second],asOf,{detailScope:true})).arrayBuffer());
 const sheet=workbook.getWorksheet('Responses');
 assert.equal(sheet.getCell('I1').value,'Form reference');assert.equal(sheet.getCell('I2').value,'form-one');assert.equal(sheet.getCell('I3').value,'form-two');
 assert.equal(sheet.getCell('J2').value,'Original purpose');
 assert.equal(sheet.getCell('K2').value,row.answers.name);assert.equal(sheet.getCell('K2').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('L2').value,'Agreed');assert.equal(sheet.getCell('F2').value,'');
 assert.match(workbook.getWorksheet('Export summary').getCell('B6').value,/saved event reference/);
 assert.equal(JSON.stringify(workbook.model).includes('PRIVATE-DIGEST'),false);assert.equal(JSON.stringify(workbook.model).includes('PRIVATE-ORIGINAL'),false);
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
test('Insights export carries the same event provenance and reconciliation limits into its summary',async()=>{
 const report={submissions:0,forms:0,events:0,days:[],years:[],months:[],eventRows:[],definitions:'Submissions are not attendance.',filters:{from:'2026-03-01',to:'2026-04-30',basis:'event',formId:'',eventId:'',searchUsed:false},coverage:{label:'Coverage incomplete'}};
 const filter=insightsExportFilter(report);
 assert.ok(filter.query.includes(INSIGHTS_PROVENANCE));
 assert.match(filter.query,/current calendar date/);assert.match(filter.query,/excluded from event-date reports/);assert.match(filter.query,/not checked by source\/index reconciliation/);
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await (await insightsWorkbook(report,asOf,{filter})).arrayBuffer());
 assert.ok(workbook.getWorksheet('Summary').getCell('B7').value.includes(INSIGHTS_PROVENANCE));
 assert.equal(workbook.getWorksheet('Summary').getCell('B2').value,0);
 assert.deepEqual(workbook.worksheets.map(sheet=>sheet.name),['Summary','Years','Months','Events','Year over year']);
 for(const sheet of ['Years','Months','Events'])assert.equal(workbook.getWorksheet(sheet).rowCount,1);
});
test('Insights PDF metrics omit event identifiers and export labels use the report scope',()=>{
 const report={submissions:2,identified:1,days:[],years:[{year:'2026',count:2}],months:[{month:'2026-03',count:2}],
  eventRows:[{id:'HIDDEN-EVENT-ID',title:'Public programme',count:2}],coverage:{label:'Coverage incomplete'},
  filters:{from:'2026-01-01',to:'2026-12-31',basis:'event',formId:'form-a',eventId:'event-a',searchUsed:true,categories:['education'],bookingType:'type-a',series:'series-a'}};
 const rows=insightsPdfMetricRows(report);
 assert.deepEqual(rows.find(row=>row.kind==='Event'),{kind:'Event',period:'Public programme',count:2});
 assert.doesNotMatch(JSON.stringify(rows),/HIDDEN-EVENT-ID/);
 const label=insightsExportFilter(report).query;
 for(const value of ['event; form form-a; event event-a','education','type-a','series-a','candidate search applied'])assert.ok(label.includes(value));
});
test('Insights workbook exports only aggregate metrics and keeps formula-like titles literal',async()=>{
 const title='=HYPERLINK("https://example.invalid")',long='Synthetic long event '.repeat(60);
 const report={submissions:124,forms:2,events:3,identified:31,days:[{date:'2025-03-01',count:24},{date:'2026-03-01',count:100}],years:[{year:'2025',count:24},{year:'2026',count:100}],months:[{month:'2026-03',count:100}],eventRows:[{id:'RESTRICTED-ID',title,count:20,contact:'SECRET-CONTACT'},{id:'PRIVATE-RECORD',title:long,count:80},{title:'Third event',count:24}],definitions:'Indexed submissions are not attendance.',filters:{from:'2025-01-01',to:'2026-12-31',basis:'event',formId:'',eventId:'',searchUsed:false},coverage:{label:'Coverage incomplete'},items:[{reference:'PRIVATE-REFERENCE',answers:'PRIVATE-ANSWER'}]};
 const filter=insightsExportFilter(report);
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await (await insightsWorkbook(report,asOf,{filter})).arrayBuffer());
 const summary=workbook.getWorksheet('Summary'),years=workbook.getWorksheet('Years'),months=workbook.getWorksheet('Months'),events=workbook.getWorksheet('Events');
 assert.equal(summary.getCell('A2').value,'Indexed submissions');assert.equal(summary.getCell('B2').value,124);assert.equal(summary.getCell('B3').value,2);assert.equal(summary.getCell('B4').value,3);
 assert.equal(summary.getCell('B6').value,'Coverage incomplete');assert.match(summary.getCell('B7').value,/current calendar date/);assert.equal(summary.getCell('B8').value,report.definitions);
 assert.equal(summary.getCell('A11').value,'Identified people (current confirmed links)');assert.equal(summary.getCell('B11').value,31);
 assert.deepEqual([years.getCell('A2').value,years.getCell('B2').value,years.getCell('A3').value,years.getCell('B3').value],['2025',24,'2026',100]);
 assert.deepEqual(workbook.getWorksheet('Year over year').getRow(2).values.slice(1,9),['2025','2026','01-01','12-31',24,100,76,76/24]);
 assert.deepEqual([months.getCell('A2').value,months.getCell('B2').value],['2026-03',100]);
 assert.equal(events.rowCount,4);assert.equal(events.getCell('A2').value,title);assert.equal(events.getCell('A2').type,ExcelJS.ValueType.String);assert.equal(events.getCell('B2').value,20);assert.equal(events.getCell('A3').value,long);assert.equal(events.getCell('B3').value,80);
 const contents=JSON.stringify(workbook.model);for(const value of ['RESTRICTED-ID','PRIVATE-RECORD','SECRET-CONTACT','PRIVATE-REFERENCE','PRIVATE-ANSWER','INSIGHT-'])assert.equal(contents.includes(value),false);
 await assert.rejects(insightsWorkbook({...report,submissions:undefined},asOf,{filter}),/incomplete/);
 await assert.rejects(insightsWorkbook(report,asOf,{filter,cancelled:()=>true}),/cancelled/);
});
test('Insights PDF uses indexed totals and keeps aggregate rows together where possible',()=>{
 const entries=[{answers:{kind:'Total',period:'All selected records',count:124}},{answers:{kind:'Event',period:'Long synthetic event',count:7}}];
 const blocks=insightsPdfBlocks(entries,124);
 assert.deepEqual(blocks,[['Total: All selected records','Indexed submissions: 124'],['Event: Long synthetic event','Indexed submissions: 7']]);
 assert.throws(()=>insightsPdfBlocks(entries,-1),/valid indexed submission count/);
 assert.match(insightsPdfBlocks([{answers:{kind:'Year-over-year change',period:'2025 to 2026',count:-3}}],124)[0][1],/Change in indexed submissions: -3/);
 const pages=paginateInsightsPdf(['header','coverage'],blocks,line=>[line],5);
 assert.deepEqual(pages,[['header','coverage',...blocks[0]],blocks[1]]);
 const long=paginateInsightsPdf(['header'],[['one','two','three','four','five','six']],line=>[line],4);
 assert.deepEqual(long,[['header'],['one','two','three','four'],['five','six']]);
});
test('year-over-year compares matching partial Sydney dates, excludes leap day and handles zero baselines',()=>{
 const values=[{date:'2024-02-28',count:2},{date:'2024-02-29',count:100},{date:'2024-03-01',count:3},{date:'2025-02-28',count:4},{date:'2025-03-01',count:6},{date:'2025-04-01',count:50}];
 assert.deepEqual(yearOverYear(values,{from:'2024-02-28',to:'2025-03-01'}),[{previousYear:'2024',year:'2025',first:'02-28',last:'03-01',before:5,after:10,change:5,percent:1}]);
 assert.equal(yearOverYear([],{from:'2024-01-01',to:'2025-12-31'})[0].percent,null);
 assert.deepEqual(yearOverYear(values,{from:'2024-12-01',to:'2025-03-01'}),[]);
 assert.deepEqual(yearOverYear(values,{from:'2024-02-29',to:'2025-03-01'})[0].first,'03-01');
 assert.deepEqual(yearOverYear(values,{from:'2025-01-01',to:'2025-12-31'}),[]);
});
