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
export async function responseWorkbook(form,rows,asOf,{cancelled=()=>false,filter=null}={}){
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
  ['Scope',filter?'All matching responses from the filtered snapshot, including pages not displayed.':'All response pages, excluding submissions after the export start time.'],
  ['Filter',filter?(filter.label||'All answers')+' contains: '+filter.query:'None'],
  ['Question versions','Each different question definition has its own column. Questions contains the saved labels, choices and consent terms.'],
  ['Privacy','Contains community responses. Share only with authorised MWA staff.'],
 ])summary.addRow(row);
 const columns=[...questions.values()],indices=new Map([...questions.keys()].map((key,index)=>[key,index+8]));
 sheet.columns=[['Reference',28],['Submitted date (Sydney)',24],['Submitted time (Sydney)',24],['Form revision',16],['Form title at submission',40],['Linked event reference',40],['Admin edit revision',20],['Last admin correction (Sydney)',30],...columns.map(question=>[question.column+': '+question.field.label,38])].map(([header,width])=>({header,width}));
 definitions.columns=[['Column',12],['Question ID',40],['Question',42],['Type',18],['Required',14],['Help text',60],['Options (one per line)',45],['Consent terms',90],['Form revisions',24]].map(([header,width])=>({header,width}));
 for(const question of columns){
  const f=question.field;definitions.addRow([question.column,String(f.id),String(f.label),String(f.type),f.required?'Yes':'No',f.description,f.options.join('\n'),f.terms,[...question.revisions].join(', ')]);
 }
 for(let index=0;index<rows.length;index++){
  if(cancelled())throw cancelledError();
  const response=rows[index],values=new Array(8+columns.length).fill('');
  values.splice(0,8,String(response.reference),new Date(date(response.createdAt)+'T00:00:00Z'),time(response.createdAt),response.revision,String(response.formTitle),String(response.eventId||''),response.editRevision||0,response.editedAt?date(response.editedAt)+' '+time(response.editedAt):'');
  for(const field of response.fields)values[indices.get(signature(field))]=answerValue(field,response.answers[field.id]);
  const row=sheet.addRow(values);row.getCell(2).numFmt='dd mmm yyyy';
  for(const field of response.fields)if(field.type==='date')row.getCell(indices.get(signature(field))+1).numFmt='dd mmm yyyy';
  if(index%200===199)await new Promise(resolve=>setTimeout(resolve,0));
 }
 for(const worksheet of [summary,sheet,definitions]){
  worksheet.eachRow((row,number)=>{row.eachCell(cell=>{cell.font={name:'Calibri',size:11};cell.alignment={vertical:'top',wrapText:true};if(number===1){cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176446'}};}});});
  worksheet.getRow(1).height=34;
 }
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:sheet.columnCount}};
 definitions.autoFilter={from:'A1',to:'I'+Math.max(1,definitions.rowCount)};
 if(cancelled())throw cancelledError();
 const buffer=await workbook.xlsx.writeBuffer();
 if(cancelled())throw cancelledError();
 return new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function downloadResponses(blob,formId,asOf){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='MWA-Responses-'+formId+'-'+date(asOf)+'.xlsx';
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
