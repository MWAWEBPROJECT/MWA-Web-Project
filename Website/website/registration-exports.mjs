import {yearOverYear} from './insights-provenance.mjs';
export const MAX_EXPORT_RESPONSES=20000;
const cancelledError=()=>Error('Export cancelled.');
const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const time=value=>new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
export async function collectResponses(api,formId,{asOf=new Date().toISOString(),cancelled=()=>false,progress=()=>{}}={}){
 const rows=[],seen=new Set(),cursors=new Set();let after='';
 do{
  if(cancelled())throw cancelledError();
  const page=await api('/'+formId+'/responses?'+new URLSearchParams({asOf,after}));
  for(const row of page.items)if(!seen.has(row.id)){seen.add(row.id);rows.push(row);}
  if(rows.length>MAX_EXPORT_RESPONSES)throw Error('This form has more than 20,000 responses. Filtering and Excel export cannot return partial results.');
  progress(rows.length);after=page.next||'';
  if(after&&cursors.has(after))throw Error('The response pages changed. Refresh and export again.');
  cursors.add(after);
 }while(after);
 if(cancelled())throw cancelledError();
 return rows;
}
const definition=field=>({id:field.id,type:field.type,label:field.label,description:field.description||'',required:field.required===true,options:field.options||[],terms:field.terms||''});
const signature=field=>JSON.stringify(definition(field));
function answerValue(field,value){
 if(value==null||value==='')return '';
 if(field.type==='consent')return value===true?'Agreed':'Not agreed';
 if(Array.isArray(value))return value.join('\n');
 if(field.type==='number'&&Number.isFinite(Number(value)))return Number(value);
 if(field.type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(value+'T00:00:00Z');
 return String(value);
}
function styleWorksheet(worksheet){
 worksheet.eachRow((row,number)=>{row.eachCell(cell=>{cell.font={name:'Calibri',size:11};cell.alignment={vertical:'top',wrapText:true};if(number===1){cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176446'}};}});});
 worksheet.getRow(1).height=34;
}
export function mappedAnswersContent(report){
 const coverage=report?.coverage,filters=report?.filters,keys=['indexed','unavailableEvent','staleSource','unreviewed','unmapped','conflicting','unsupported'];
 if(!report||typeof report.concept!=='string'||!Array.isArray(report.groups)||!coverage||keys.some(key=>!Number.isSafeInteger(coverage[key])||coverage[key]<0)||!filters||!['event','submission'].includes(filters.basis)||!filters.from||!filters.to||!Number.isFinite(Date.parse(report.generatedAt))||typeof report.notice!=='string')throw Error('The mapped-answer report is incomplete. Run it again before exporting.');
 const header=[`Concept: ${report.concept}${report.concept2?' × '+report.concept2:''}`,`Period: ${filters.from} to ${filters.to} (Sydney); ${filters.basis==='event'?'current calendar event date':'submission date'}`,`Scope: ${filters.formId?'form '+filters.formId:'all forms'}; ${filters.eventFiltered?'one selected event':'all accessible events'}; programme categories ${(filters.categories||[]).join(', ')||'all'}; booking type ${filters.bookingType||'all'}; recurring series ${filters.series||'all'}; ${filters.searchUsed?'candidate search filter applied (search text omitted)':'no candidate search'}`,`Generated Sydney: ${date(report.generatedAt)} ${time(report.generatedAt)}`,`Indexed submissions: ${coverage.indexed}`,`Unavailable events: ${coverage.unavailableEvent}; stale sources: ${coverage.staleSource}; unreviewed: ${coverage.unreviewed}; unmapped: ${coverage.unmapped}; conflicting: ${coverage.conflicting}; unsupported/personal: ${coverage.unsupported}`,report.notice];
 if(report.concept2){
  if(typeof report.concept2!=='string'||!Array.isArray(report.crossTabs)||report.groups.length)throw Error('The cross-tab report is incomplete. Run it again before exporting.');
  const blocks=report.crossTabs.map((group,index)=>{
   if(!Array.isArray(group.definitions)||group.definitions.length!==2||group.definitions.some(def=>typeof def.label!=='string'||!['select','radio','checkboxes'].includes(def.type)||!Array.isArray(def.options)||def.options.some(option=>typeof option!=='string'))||['eligible','answered','missing','invalid'].some(key=>!Number.isSafeInteger(group[key])||group[key]<0)||!Array.isArray(group.counts)||group.counts.length!==group.definitions[0].options.length||group.counts.some(row=>!Array.isArray(row)||row.length!==group.definitions[1].options.length||row.some(count=>!Number.isSafeInteger(count)||count<0)))throw Error('The cross-tab report contains invalid metrics.');
   const [left,right]=group.definitions,lines=[`Definition pair ${index+1}: ${left.label} (${left.type}) × ${right.label} (${right.type})`,`Eligible: ${group.eligible}; answered both: ${group.answered}; missing: ${group.missing}; invalid: ${group.invalid}. Denominator: ${group.answered} responses answering both.`];
   left.options.forEach((a,i)=>right.options.forEach((b,j)=>lines.push(`${a} × ${b}: ${group.counts[i][j]} responses; ${group.answered?(group.counts[i][j]/group.answered*100).toFixed(1)+'%':'Unavailable'} of responses answering both.`)));
   return lines;
  });
  return {header,blocks};
 }
 const blocks=report.groups.map((group,index)=>{
  if(typeof group.label!=='string'||!['number','select','radio','checkboxes'].includes(group.type)||['eligible','answered','missing','invalid'].some(key=>!Number.isSafeInteger(group[key])||group[key]<0))throw Error('The mapped-answer report contains an invalid definition.');
  const lines=[`Definition ${index+1}: ${group.label} (${group.type})`,`Eligible responses: ${group.eligible}; answered: ${group.answered}; missing: ${group.missing}; invalid: ${group.invalid}. Denominator: ${group.answered} answered responses.`];
  if(group.type==='number'){
   if([group.min,group.max,group.mean].some(value=>value!==null&&!Number.isFinite(value)))throw Error('The mapped-answer report contains invalid numeric metrics.');
   lines.push(`Minimum: ${group.min??'Unavailable'}; maximum: ${group.max??'Unavailable'}; mean: ${group.mean??'Unavailable'}.`);
  }else{
   if(!Array.isArray(group.options)||group.options.some(option=>typeof option.label!=='string'||!Number.isSafeInteger(option.count)||option.count<0))throw Error('The mapped-answer report contains invalid choice metrics.');
   for(const option of group.options)lines.push(`${option.label}: ${option.count} responses; ${group.answered?(option.count/group.answered*100).toFixed(1)+'%':'Unavailable'} of answered responses.`);
   if(group.type==='checkboxes')lines.push('Multiple selections per response; percentages may total more than 100%.');
  }
  return lines;
 });
 return {header,blocks};
}
export async function mappedAnswersWorkbook(report,{cancelled=()=>false}={}){
 if(cancelled())throw cancelledError();
 const {header}=mappedAnswersContent(report),ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 workbook.creator='Muhammadi Welfare Association';workbook.created=new Date(report.generatedAt);
 const summary=workbook.addWorksheet('Summary'),definitions=workbook.addWorksheet('Definitions',{views:[{state:'frozen',ySplit:1}]}),choices=workbook.addWorksheet('Choice counts',{views:[{state:'frozen',ySplit:1}]});
 summary.columns=[{width:28},{width:110}];summary.addRow(['Mapped-answer analysis','Aggregate only']);for(const line of header)summary.addRow(['Provenance / coverage',line]);
 definitions.columns=[['Definition',16],['Question',50],['Type',18],['Eligible responses',22],['Answered responses',22],['Missing',16],['Invalid',16],['Minimum',18],['Maximum',18],['Mean',18]].map(([header,width])=>({header,width}));
 choices.columns=[['Definition',16],['Saved option',50],['Responses selecting option',28],['Answered denominator',24],['Percent of answered',24]].map(([header,width])=>({header,width}));
 if(report.concept2){
  const pairs=workbook.addWorksheet('Cross-tab cells',{views:[{state:'frozen',ySplit:1}]});
  pairs.columns=[['Definition pair',18],['First question',40],['First option',35],['Second question',40],['Second option',35],['Responses',18],['Answered both',20],['Percent of answered both',26],['Eligible',16],['Missing',16],['Invalid',16]].map(([header,width])=>({header,width}));
  for(let n=0;n<report.crossTabs.length;n++){
   if(cancelled())throw cancelledError();
   const group=report.crossTabs[n],[left,right]=group.definitions;
   left.options.forEach((a,i)=>right.options.forEach((b,j)=>{const row=pairs.addRow([n+1,left.label,a,right.label,b,group.counts[i][j],group.answered,group.answered?group.counts[i][j]/group.answered:null,group.eligible,group.missing,group.invalid]);row.getCell(8).numFmt='0.0%';}));
   if(n%50===49)await new Promise(resolve=>setTimeout(resolve,0));
  }
  styleWorksheet(pairs);
 }
 for(let i=0;i<report.groups.length;i++){
  if(cancelled())throw cancelledError();
  const group=report.groups[i];definitions.addRow([i+1,group.label,group.type,group.eligible,group.answered,group.missing,group.invalid,group.type==='number'?group.min:'',group.type==='number'?group.max:'',group.type==='number'?group.mean:'']);
  if(group.type!=='number')for(const option of group.options){const row=choices.addRow([i+1,option.label,option.count,group.answered,group.answered?option.count/group.answered:null]);row.getCell(5).numFmt='0.0%';}
  if(i%200===199)await new Promise(resolve=>setTimeout(resolve,0));
 }
 for(const sheet of [summary,definitions,choices])styleWorksheet(sheet);
 if(cancelled())throw cancelledError();const buffer=await workbook.xlsx.writeBuffer();if(cancelled())throw cancelledError();
 return new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export async function mappedAnswersPdf(report,{cancelled=()=>false}={}){
 const {header,blocks}=mappedAnswersContent(report);
 if(blocks.reduce((sum,block)=>sum+block.length,header.length)>5000)throw Error('This PDF exceeds 5,000 metric lines. Narrow the report or use Excel; no partial PDF was exported.');
 if(cancelled())throw cancelledError();
 const [{jsPDF},brand]=await Promise.all([import('jspdf'),import('@calendar/services/pdfBranding.js')]);
 const {W,MARGIN,BODY_BOTTOM,resolvePdfTheme,pdfLogo,makeCanvas,ensureFonts,font,wrap,startPage,drawHeader}=brand;
 await ensureFonts();const theme=resolvePdfTheme(),logo=await pdfLogo({}),probe=makeCanvas();font(probe.ctx,12);
 const pages=paginateInsightsPdf(header,blocks,line=>wrap(probe.ctx,line,W-2*MARGIN)),pdf=new jsPDF({unit:'mm',format:'a4'});
 for(let i=0;i<pages.length;i++){
  if(cancelled())throw cancelledError();const {canvas,ctx}=makeCanvas();startPage(ctx,theme);drawHeader(ctx,logo,theme,{kicker:'Form Insights',title:'Mapped-answer analysis',subtitle:'Reviewed aggregate concepts',detail:'Aggregate report · Confidential'});font(ctx,12);ctx.fillStyle=theme.ink;ctx.textAlign='left';pages[i].forEach((line,j)=>ctx.fillText(line,MARGIN,270+j*17));font(ctx,10);ctx.fillText(`Generated ${date(report.generatedAt)} · Page ${i+1} of ${pages.length}`,MARGIN,BODY_BOTTOM+35);if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297,undefined,'FAST');
 }
 if(cancelled())throw cancelledError();return pdf.output('blob');
}
export function cohortHeatmapContent(report){
 const {filters,coverage,years,rows}=report||{},keys=['indexed','staleIndex','unavailable','unmapped','unresolved'];
 if(!filters||!coverage||keys.some(key=>!Number.isSafeInteger(coverage[key])||coverage[key]<0)||!Array.isArray(years)||years.some(y=>typeof y!=='string'||!/^\d{4}$/.test(y))||!Array.isArray(rows)||rows.some(row=>typeof row.cohortYear!=='string'||!/^\d{4}$/.test(row.cohortYear)||!Array.isArray(row.counts)||row.counts.length!==years.length||row.counts.some(count=>!Number.isSafeInteger(count)||count<0))||!report.historyFrom||!report.from||!report.to||!Number.isFinite(Date.parse(report.generatedAt))||typeof report.notice!=='string')throw Error('The cohort report is incomplete. Run it again before exporting.');
 const header=[`History start: ${report.historyFrom}; period: ${report.from} to ${report.to} (Sydney submission dates).`,`Scope: form ${filters.formId||'all'}; saved event ${filters.eventId||'all'}; programme categories ${(filters.categories||[]).join(', ')||'all'}; booking type ${filters.bookingType||'all'}; recurring series ${filters.series||'all'}.`,`Generated Sydney: ${date(report.generatedAt)} ${time(report.generatedAt)}`,`Indexed: ${coverage.indexed}; unresolved: ${coverage.unresolved}; unmapped: ${coverage.unmapped}; stale index: ${coverage.staleIndex}; unavailable events: ${coverage.unavailable}.`,report.notice];
 const blocks=rows.map(row=>[`First-known ${row.cohortYear}`, ...years.map((year,index)=>`${year}${report.from>year+'-01-01'||report.to<year+'-12-31'?' (partial)':''}: ${row.counts[index]} confirmed respondents.`)]);
 return {header,blocks};
}
export async function cohortHeatmapWorkbook(report,{cancelled=()=>false}={}){
 const {header}=cohortHeatmapContent(report);if(cancelled())throw cancelledError();
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();workbook.creator='Muhammadi Welfare Association';workbook.created=new Date(report.generatedAt);
 const summary=workbook.addWorksheet('Summary'),sheet=workbook.addWorksheet('Cohorts',{views:[{state:'frozen',ySplit:1}]});
 summary.columns=[{width:26},{width:110}];summary.addRow(['Cohort heatmap','Aggregate only']);for(const line of header)summary.addRow(['Provenance / coverage',line]);
 sheet.columns=[{header:'First-known year',width:20},...report.years.map(year=>({header:year+(report.from>year+'-01-01'||report.to<year+'-12-31'?' (partial)':''),width:22}))];
 for(const row of report.rows)sheet.addRow([row.cohortYear,...row.counts]);
 styleWorksheet(summary);styleWorksheet(sheet);if(cancelled())throw cancelledError();
 const buffer=await workbook.xlsx.writeBuffer();if(cancelled())throw cancelledError();return new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export async function cohortHeatmapPdf(report,{cancelled=()=>false}={}){
 const {header,blocks}=cohortHeatmapContent(report);if(cancelled())throw cancelledError();
 const [{jsPDF},brand]=await Promise.all([import('jspdf'),import('@calendar/services/pdfBranding.js')]);
 const {W,MARGIN,BODY_BOTTOM,resolvePdfTheme,pdfLogo,makeCanvas,ensureFonts,font,wrap,startPage,drawHeader}=brand;
 await ensureFonts();const theme=resolvePdfTheme(),logo=await pdfLogo({}),probe=makeCanvas();font(probe.ctx,12);
 const pages=paginateInsightsPdf(header,blocks,line=>wrap(probe.ctx,line,W-2*MARGIN)),pdf=new jsPDF({unit:'mm',format:'a4'});
 for(let i=0;i<pages.length;i++){
  if(cancelled())throw cancelledError();const {canvas,ctx}=makeCanvas();startPage(ctx,theme);drawHeader(ctx,logo,theme,{kicker:'Form Insights',title:'First-known-year cohorts',subtitle:'Confirmed respondents · aggregate only',detail:'Aggregate report · Confidential'});font(ctx,12);ctx.fillStyle=theme.ink;ctx.textAlign='left';pages[i].forEach((line,j)=>ctx.fillText(line,MARGIN,270+j*17));font(ctx,10);ctx.fillText(`Generated ${date(report.generatedAt)} · Page ${i+1} of ${pages.length}`,MARGIN,BODY_BOTTOM+35);if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297,undefined,'FAST');
 }
 if(cancelled())throw cancelledError();return pdf.output('blob');
}
export async function insightsWorkbook(report,asOf,{cancelled=()=>false,filter}={}){
 if(cancelled())throw cancelledError();
 if(!Number.isSafeInteger(report?.submissions)||report.submissions<0||!Number.isSafeInteger(report.forms)||report.forms<0||!Number.isSafeInteger(report.events)||report.events<0||!Array.isArray(report.days)||!Array.isArray(report.years)||!Array.isArray(report.months)||!Array.isArray(report.eventRows)||typeof report.coverage?.label!=='string'||typeof report.definitions!=='string'||!filter||typeof filter.query!=='string')throw Error('The Insights aggregate report is incomplete. Run it again before exporting.');
 if(report.days.some(item=>!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||!Number.isSafeInteger(item.count)||item.count<0))throw Error('The Insights aggregate report contains an invalid daily metric. Run it again before exporting.');
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 workbook.creator='Muhammadi Welfare Association';workbook.created=new Date(asOf);
 const summary=workbook.addWorksheet('Summary');
 summary.columns=[{width:30},{width:100}];
 for(const item of [
  ['Muhammadi Welfare Association','Registration insights — aggregate report'],
  ['Indexed submissions',report.submissions],['Forms with indexed submissions',report.forms],['Events receiving indexed submissions',report.events],
  ['Generated (Sydney)',date(asOf)+' '+time(asOf)],['Coverage',String(report.coverage.label)],
  ['Selected filters and provenance',filter.query],
  ['Definitions',String(report.definitions)],['Privacy','Aggregate data only. Share only with authorised MWA staff.'],
  ['Year-over-year definition','Matching Sydney month/day windows within the selected period are compared. 29 February is excluded from both years. Percentage is unavailable when the previous count is zero; coverage may be incomplete.']
 ])summary.addRow(item);
 if(report.identified!==undefined){if(!Number.isSafeInteger(report.identified)||report.identified<0)throw Error('The Insights identified-people count is invalid. Run it again before exporting.');summary.addRow(['Identified people (current confirmed links)',report.identified]);}
 for(const [name,label,items,key] of [['Years','Sydney year',report.years,'year'],['Months','Sydney month',report.months,'month'],['Events','Event',report.eventRows,'title']]){
  const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[{header:label,width:name==='Events'?75:24},{header:'Indexed submissions',width:24}];
  for(let i=0;i<items.length;i++){
   if(cancelled())throw cancelledError();
   const item=items[i];
   if(typeof item[key]!=='string'||!Number.isSafeInteger(item.count)||item.count<0)throw Error('The Insights aggregate report contains an invalid metric. Run it again before exporting.');
   sheet.addRow([item[key],item.count]);
   if(i%200===199)await new Promise(resolve=>setTimeout(resolve,0));
  }
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,items.length+1),column:2}};
  styleWorksheet(sheet);
 }
 const comparisons=yearOverYear(report.days,report.filters);
 const yoy=workbook.addWorksheet('Year over year',{views:[{state:'frozen',ySplit:1}]});
 yoy.columns=[['Previous year',20],['Current year',20],['Window start (MM-DD)',24],['Window end (MM-DD)',24],['Previous submissions',24],['Current submissions',24],['Change',16],['Percent change',24]].map(([header,width])=>({header,width}));
 for(const item of comparisons){const row=yoy.addRow([item.previousYear,item.year,item.first,item.last,item.before,item.after,item.change,item.percent]);row.getCell(8).numFmt='0.0%';}
 styleWorksheet(yoy);
 styleWorksheet(summary);
 if(cancelled())throw cancelledError();
 const buffer=await workbook.xlsx.writeBuffer();
 if(cancelled())throw cancelledError();
 return new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export async function responseWorkbook(form,rows,asOf,{cancelled=()=>false,filter=null,detailScope=false}={}){
 if(cancelled())throw cancelledError();
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
 workbook.creator='Muhammadi Welfare Association';workbook.created=new Date(asOf);
 const questions=new Map();
 function include(fields,revision){
  for(const field of fields){
   const key=signature(field);
   if(!questions.has(key)){
    if(questions.size>=16376)throw Error('There are too many different question versions for one Excel worksheet. No partial file was exported.');
    questions.set(key,{field:definition(field),column:'Q'+(questions.size+1),revisions:new Set()});
   }
   questions.get(key).revisions.add(revision);
  }
 }
 if(!rows.length)include(form.fields,form.revision);
 for(const row of rows)include(row.fields,row.revision);
 const summary=workbook.addWorksheet('Export summary'),sheet=workbook.addWorksheet('Responses',{views:[{state:'frozen',xSplit:1,ySplit:1}]}),definitions=workbook.addWorksheet('Questions',{views:[{state:'frozen',ySplit:1}]});
 summary.columns=[{width:30},{width:100}];
 for(const row of [
  ['Muhammadi Welfare Association','Registration responses'],
  ['Form',String(form.title)],['Form reference',form.id],['Responses',rows.length],
  ['Response cutoff (Sydney)',date(asOf)+' '+time(asOf)],
  ['Scope',detailScope?'Complete filtered subset of the assigned form/event scope from source responses. Event scope uses the saved event reference; calendar details are not included.':filter?'All matching responses from the filtered snapshot, including pages not displayed.':'All response pages, excluding submissions after the export start time.'],
  ['Filter',filter?(filter.label||'All answers')+(detailScope?': ':' contains: ')+filter.query:'None'],
  ['Question versions','Each different question definition has its own column. Questions contains the saved labels, choices and consent terms.'],
  ['Privacy','Contains community responses. Share only with authorised MWA staff.'],
 ])summary.addRow(row);
 const baseColumns=[['Reference',28],['Submitted date (Sydney)',24],['Submitted time (Sydney)',24],['Form revision',16],['Form title at submission',40],['Linked event reference',40],['Admin edit revision',20],['Last admin correction (Sydney)',30],...(detailScope?[['Form reference',40],['Purpose at submission',60]]:[])];
 const columns=[...questions.values()],indices=new Map([...questions.keys()].map((key,index)=>[key,index+baseColumns.length]));
 sheet.columns=[...baseColumns,...columns.map(question=>[question.column+': '+question.field.label,38])].map(([header,width])=>({header,width}));
 definitions.columns=[['Column',12],['Question ID',40],['Question',42],['Type',18],['Required',14],['Help text',60],['Options (one per line)',45],['Consent terms',90],['Form revisions',24]].map(([header,width])=>({header,width}));
 for(const question of columns){
  const f=question.field;definitions.addRow([question.column,String(f.id),String(f.label),String(f.type),f.required?'Yes':'No',f.description,f.options.join('\n'),f.terms,[...question.revisions].join(', ')]);
 }
 for(let index=0;index<rows.length;index++){
  if(cancelled())throw cancelledError();
  const response=rows[index],values=new Array(baseColumns.length+columns.length).fill('');
  values.splice(0,8,String(response.reference),new Date(date(response.createdAt)+'T00:00:00Z'),time(response.createdAt),response.revision,String(response.formTitle),String(response.eventId||''),response.editRevision||0,response.editedAt?date(response.editedAt)+' '+time(response.editedAt):'');
  if(detailScope){values[8]=String(response.formId);values[9]=String(response.purpose||'');}
  for(const field of response.fields)values[indices.get(signature(field))]=answerValue(field,response.answers[field.id]);
  const row=sheet.addRow(values);row.getCell(2).numFmt='dd mmm yyyy';
  for(const field of response.fields)if(field.type==='date')row.getCell(indices.get(signature(field))+1).numFmt='dd mmm yyyy';
  if(index%200===199)await new Promise(resolve=>setTimeout(resolve,0));
 }
 for(const worksheet of [summary,sheet,definitions])styleWorksheet(worksheet);
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:sheet.columnCount}};
 definitions.autoFilter={from:'A1',to:'I'+Math.max(1,definitions.rowCount)};
 if(cancelled())throw cancelledError();
 const buffer=await workbook.xlsx.writeBuffer();
 if(cancelled())throw cancelledError();
 return new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function downloadResponses(blob,formId,asOf,format='xlsx'){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='MWA-Responses-'+formId+'-'+date(asOf)+'.'+format;
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function insightsPdfBlocks(rows,submissions){
 if(!Number.isSafeInteger(submissions)||submissions<0)throw Error('A valid indexed submission count is required for the Insights PDF.');
 return rows.map(row=>[`${row.answers.kind}: ${row.answers.period}`,`${row.answers.kind==='Year-over-year change'?'Change in indexed submissions':'Indexed submissions'}: ${row.answers.count}`]);
}
export function paginateInsightsPdf(header,blocks,wrapLine,limit=47){
 const pages=[[]];
 for(const block of [header,...blocks]){
  const lines=block.flatMap(line=>wrapLine(String(line)));
  let page=pages.at(-1);
  if(page.length&&page.length+lines.length>limit){page=[];pages.push(page);}
  while(lines.length){
   const available=limit-page.length;
   page.push(...lines.splice(0,available));
   if(lines.length){page=[];pages.push(page);}
  }
 }
 return pages;
}
export async function responsePdf(form,rows,asOf,{cancelled=()=>false,filter=null,insights=null}={}){
 const [{jsPDF},brand]=await Promise.all([import('jspdf'),import('@calendar/services/pdfBranding.js')]);
 const {W,H,MARGIN,BODY_BOTTOM,resolvePdfTheme,pdfLogo,makeCanvas,ensureFonts,font,wrap,startPage,drawHeader}=brand;
 await ensureFonts();const theme=resolvePdfTheme(),logo=await pdfLogo({});const probe=makeCanvas();font(probe.ctx,12);
 let pages;
 if(insights){
  const header=[`Report: ${form.title}`,`Indexed submissions: ${insights.submissions} · Generated Sydney · ${date(asOf)} ${time(asOf)}`,filter?`Filter: ${filter.label||'All answers'}: ${filter.query}`:'Filter: none','Confidential — authorised MWA use only.'];
  pages=paginateInsightsPdf(header,insightsPdfBlocks(rows,insights.submissions),line=>wrap(probe.ctx,line,W-2*MARGIN));
 }else{
  const lines=[`Form: ${form.title}`,`Responses: ${rows.length} · Sydney · ${date(asOf)} ${time(asOf)}`,filter?`Filter: ${filter.label||'All answers'} contains ${filter.query}`:'Filter: none','Confidential — authorised MWA use only.'];
  for(const row of rows){lines.push('',`${row.reference} · ${date(row.createdAt)} ${time(row.createdAt)}`);for(const field of row.fields)lines.push(`${field.label}: ${answerValue(field,row.answers[field.id])}`);}
  const wrapped=lines.flatMap(line=>wrap(probe.ctx,String(line),W-2*MARGIN));pages=[];for(let i=0;i<wrapped.length;i+=47)pages.push(wrapped.slice(i,i+47));
 }
 const pdf=new jsPDF({unit:'mm',format:'a4'});
 for(let i=0;i<pages.length;i++){if(cancelled())throw cancelledError();const {canvas,ctx}=makeCanvas();startPage(ctx,theme);drawHeader(ctx,logo,theme,{kicker:insights?'Form Insights':'Form Builder',title:insights?'Registration insights':'Registration responses',subtitle:form.title,detail:insights?'Filtered aggregate report · Confidential':'Filtered response report · Confidential'});font(ctx,12);ctx.fillStyle=theme.ink;ctx.textAlign='left';pages[i].forEach((line,j)=>ctx.fillText(line,MARGIN,270+j*17));font(ctx,10);ctx.fillText(`Generated ${date(asOf)} · Page ${i+1} of ${pages.length}`,MARGIN,BODY_BOTTOM+35);if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297,undefined,'FAST');}
 return pdf.output('blob');
}
