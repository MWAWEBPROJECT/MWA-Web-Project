import {auth} from '@calendar/firebase/firebase.js';
export async function niazApi(path,body,verification){
 const user=auth.currentUser;
 const headers={'Content-Type':'application/json'};
 if(user)headers.Authorization='Bearer '+await user.getIdToken();
 if(verification&&!body)headers['X-Niaz-Verification']=JSON.stringify(verification);
 if(auth.currentUser?.uid!==user?.uid)throw Error('Your session changed. Refresh Niaz before continuing.');
 let response;
 try{response=await fetch('/api/niaz'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify({...body,...(verification?{verification}:{})}):undefined,cache:'no-store',signal:AbortSignal.timeout(30000)});}
 catch(error){if(error.name==='TimeoutError')throw Error('Niaz timed out. A change may have been saved; refresh the record before retrying.');throw error;}
 const data=await response.json();
 if(auth.currentUser?.uid!==user?.uid)throw Error('Your session changed. Refresh Niaz before continuing.');
 if(!response.ok)throw Error(data.error||'Niaz could not complete this request.');return data;
}
export const importColumns=['name','email','phone','eventDate','eventId','type','seriesId','role','publicConsent','inKind','notes','memberId'];
export const importHeaders=['Name','Email','Mobile','Date','Event Id','Sponsorship Type','Series Id','Role','Public Consent','Additional Offers / Requests','Notes','Member Id'];
export function importMapping(headers){
 const normal=value=>String(value).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
 return Object.fromEntries(importColumns.map((key,index)=>[key,headers.findIndex(header=>[normal(key),normal(importHeaders[index]),...(key==='inKind'?['inkindprovision']:[])].includes(normal(header)))]));
}
export function mapImportRows(data,mapping){
 return data.rows.map(row=>{
  const value=Object.fromEntries(importColumns.map(key=>[key,mapping[key]<0?'':row[mapping[key]]]));
  const date=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value.eventDate||'').trim());
  if(date)value.eventDate=date[3]+'-'+date[2]+'-'+date[1];
  if(/^(true|false)$/i.test(String(value.publicConsent)))value.publicConsent=String(value.publicConsent).toLowerCase();
  return value;
 });
}
export async function importTemplate(){
 const {buildImportTemplateWorkbook}=await import('@calendar/services/templateService.js');
 const examples=['one_time','annual','permanent'].map((type,index)=>['Example sponsor '+(index+1),'example'+(index+1)+'@example.org','','11/01/2027','replace-with-event-id',type,type==='permanent'?'replace-with-series-id':'','joint','false','Example food / serving offer','Replace all example values before import','']);
 const book=await buildImportTemplateWorkbook({sheetName:'Niaz Sponsors',headers:importHeaders,dataRows:examples,widths:[30,30,22,18,30,22,30,18,20,42,42,22],lastRow:501,textColumns:[3,4,5,7,12],lists:[['Sponsorship Types','Roles','Public Consent'],['one_time','joint','false'],['annual','sole','true'],['permanent','contributor','']],validations:[{col:6,source:'"one_time,annual,permanent"'},{col:8,source:'"sole,joint,contributor"'},{col:9,source:'"false,true"'}],instructions:[
  ['MWA Niaz Sponsorship - sponsor/event import'],[''],
  ['Fill in the "Niaz Sponsors" sheet (keep the header row). Required: Name, Email or Mobile, Date, Sponsorship Type. Replace all three example rows with real reviewed records.'],
  ['Date format is DD/MM/YYYY (day first), e.g. 11/01/2027 is 11 January 2027. Dates refer to the Gregorian Australia/Sydney programme date. Legacy YYYY-MM-DD text is also accepted.'],
  ['Keep Date, Mobile and reference columns as Text. Do not use ambiguous short years, Hijri dates or formulas.'],
  ['Event Id must match an existing confirmed public MWA programme on that date; it is required when more than one programme matches. Use Programme date > Find programmes, never guess by title.'],
  ['Sponsorship Type: one_time, annual or permanent. A permanent row requires the event\'s stable Series Id. Role: sole, joint or contributor. Dropdowns are conveniences; the server revalidates every row.'],
  ['Public Consent defaults to false (private). Enter true only after obtaining explicit revocable public-name consent. Reviewed imports create approved coordinator assignments immediately.'],
  ['Member Id is reserved and must stay blank: authoritative membership linking is not configured. No payment or membership is created by importing.'],
  ['Additional Offers / Requests and Notes are optional private coordination details. No cash amounts or payment success may be entered here.'],
  ['Save as .xlsx (preserves Lists/dropdowns/Instructions), or save the Niaz Sponsors sheet only as UTF-8 .csv. CSV supports quoted commas/newlines; it does not preserve workbook instructions or dropdowns.'],
  ['Import accepts at most 500 rows and a 2 MB file; server preview has a smaller 800 KB data limit. Review errors/duplicates before importing resumable batches of 40. Existing legacy Calendar fields are not overwritten.']
 ]});
 return new Blob([await book.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export async function readImport(file){
 if(file.size>2*1024*1024)throw Error('Choose an import under 2 MB.');
 if(file.name.toLowerCase().endsWith('.csv'))return parseCSV(await file.text());
 if(!file.name.toLowerCase().endsWith('.xlsx'))throw Error('Choose an Excel .xlsx or UTF-8 .csv file.');
 const XLSX=await import('xlsx'),book=XLSX.read(await file.arrayBuffer(),{type:'array',sheetRows:502});
 const sheet=book.Sheets[book.SheetNames[0]];
 if(!sheet||XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1').e.r>500)throw Error('Use a header and up to 500 rows.');
 const [headers=[],...rows]=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
 return {headers:headers.map(String),rows:rows.filter(row=>row.some(value=>String(value).trim()))};
}
export async function workbook(sheets){
 const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();
 for(const [title,rows] of Object.entries(sheets)){
  const sheet=book.addWorksheet(title.slice(0,31));sheet.views=[{state:'frozen',ySplit:1}];
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  sheet.columns=keys.map(key=>({header:key,key,width:Math.min(42,Math.max(18,key.length+3))}));
  for(const row of rows)sheet.addRow(Object.fromEntries(keys.map(key=>[key,typeof row[key]==='object'?JSON.stringify(row[key]):row[key]??''])));
  sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true};});
  if(keys.length)sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:keys.length}};
 }
 return new Blob([await book.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function download(blob,name){
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function parseCSV(source){
 const rows=[],row=[];let cell='',quoted=false;
 for(let i=0;i<source.length;i++){
  const char=source[i];
  if(char==='"'){
   if(quoted&&source[i+1]==='"'){cell+='"';i++;}
   else if(quoted)quoted=false;
   else if(!cell)quoted=true;
   else throw Error('Invalid CSV quoting; check the template.');
  }else if(!quoted&&(char===','||char==='\n'||char==='\r')){
   row.push(cell);cell='';
   if(char!==','){if(char==='\r'&&source[i+1]==='\n')i++;rows.push([...row]);row.length=0;}
  }else cell+=char;
 }
 if(quoted)throw Error('Unclosed quoted CSV cell.');
 if(cell||row.length){row.push(cell);rows.push([...row]);}
 if(!rows.length||rows.length>501)throw Error('Use a header and up to 500 rows.');
 const headers=rows.shift().map(value=>value.replace(/^\uFEFF/,''));
 if(rows.some(value=>value.length!==headers.length))throw Error('Each CSV row must match the header column count.');
 return {headers,rows};
}
