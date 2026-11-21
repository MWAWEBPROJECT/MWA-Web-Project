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
export const importColumns=['name','email','phone','notes','publicConsent','active'];
export const importHeaders=['Name','Email','Mobile','Internal Notes','Public Consent','Active'];
export function importMapping(headers){
 const normal=value=>String(value).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
 return Object.fromEntries(importColumns.map((key,index)=>[key,headers.findIndex(header=>[normal(key),normal(importHeaders[index])].includes(normal(header)))]));
}
export function mapImportRows(data,mapping){
 return data.rows.map(row=>{
  const value=Object.fromEntries(importColumns.map(key=>[key,mapping[key]<0?'':row[mapping[key]]]));
  value.name=String(value.name||'').trim();
  value.email=String(value.email||'').trim();
  value.phone=String(value.phone||'').trim();
  value.notes=String(value.notes||'').trim();
  value.publicConsent=/^(true|yes|1)$/i.test(String(value.publicConsent||'').trim());
  value.active=!/^(false|no|0)$/i.test(String(value.active||'').trim());
  return value;
 });
}
export async function importTemplate(){
 const {buildImportTemplateWorkbook}=await import('@calendar/services/templateService.js');
 const book=await buildImportTemplateWorkbook({sheetName:'Niaz Sponsors',headers:importHeaders,dataRows:[],widths:[30,32,24,48,20,16],lastRow:501,textColumns:[3],validations:[{col:5,source:'"true,false"'},{col:6,source:'"true,false"'}],instructions:[
  ['MWA Niaz Sponsor Directory - contact import'],[''],
  ['Fill in the Niaz Sponsors sheet. Name is required; Email, Mobile, Internal Notes, Public Consent and Active are optional.'],
  ['Public Consent defaults to false. Enter true only with explicit permission to publish the sponsor name. Active defaults to true.'],
  ['Keep mobile numbers as Text, including 04xxxxxxxx. Import creates contacts only; it does not assign events, create donations or send emails.'],
  ['Existing email/mobile contacts are skipped for coordinator review. Import up to 500 data rows per file; errors are shown per row.']
 ]});
 return new Blob([await book.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export async function readImport(file){
 if(file.size>2*1024*1024)throw Error('Choose an import under 2 MB.');
 if(file.name.toLowerCase().endsWith('.csv')){const parsed=parseCSV(await file.text());if(parsed.rows.length>500)throw Error('Use a header and up to 500 populated rows.');return parsed;}
 if(!file.name.toLowerCase().endsWith('.xlsx'))throw Error('Choose an Excel .xlsx or UTF-8 .csv file.');
 const XLSX=await import('xlsx'),book=XLSX.read(await file.arrayBuffer(),{type:'array'});
 const sheet=book.Sheets['Niaz Sponsors']||book.Sheets[book.SheetNames[0]];
 if(!sheet)throw Error('Choose a workbook with a sponsor sheet.');
 const [headers=[],...rows]=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
 const populated=rows.filter(row=>row.some(value=>String(value).trim()));
 if(!headers.some(value=>String(value).trim())||populated.length>500)throw Error('Use a header and up to 500 populated rows.');
 return {headers:headers.map(String),rows:populated};
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
