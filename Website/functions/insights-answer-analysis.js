const {createHash}=require('node:crypto');
const Mapping=require('./insights-mapping');
const State=require('./insights-state');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const version=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
async function documents(db,refs){
 const unique=[...new Map(refs.map(ref=>[ref.path,ref])).values()],out=new Map();
 for(let i=0;i<unique.length;i+=200)for(const doc of await db.getAll(...unique.slice(i,i+200)))out.set(doc.ref.path,doc);
 return out;
}
const signature=docs=>digest(JSON.stringify([...docs.values()].map(doc=>[doc.ref.path,version(doc)]).sort((a,b)=>a[0].localeCompare(b[0]))));
function validateConcepts(concept,concept2=''){
 if(typeof concept!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(concept))fail(400,'Enter a valid reviewed concept key.');
 if(concept2&&(typeof concept2!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(concept2)||concept2===concept))fail(400,'Choose two different valid reviewed concept keys.');
}
function emptyAccumulator(){
 return {coverage:{indexed:0,unavailableEvent:0,staleSource:0,unreviewed:0,unmapped:0,conflicting:0,unsupported:0},groups:[],crossTabs:[]};
}
function accumulate(previous,rows,docs,concept,visibleEvents,calendarAllowed,concept2=''){
 validateConcepts(concept,concept2);
 const coverage={...previous.coverage,indexed:previous.coverage.indexed+rows.length};
 const groups=new Map(previous.groups.map(group=>[group.id,{...group,counts:new Map(group.counts)}]));
 const crossTabs=new Map(previous.crossTabs.map(group=>[group.id,{...group,counts:group.counts.map(row=>[...row])}]));
 let crossCells=[...crossTabs.values()].reduce((total,group)=>total+group.definitions[0].options.length*group.definitions[1].options.length,0);
 for(const row of rows){
  const source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),data=source.data();
  if(!source.exists||data.createdAt!==row.submittedAt||(data.eventId||'')!==(row.eventId||'')){coverage.staleSource++;continue;}
  if(data.eventId&&!calendarAllowed&&!visibleEvents.has(data.eventId)){coverage.unavailableEvent++;continue;}
  const fields=Mapping.schema(data.fields),mapping=docs.get(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${data.revision}`)?.data();
  if(!fields||!mapping||mapping.status!=='reviewed'||mapping.schemaHash!==Mapping.hashSchema(fields)){coverage.unreviewed++;continue;}
  let entries;try{entries=Mapping.cleanEntries(mapping.entries,fields);}catch{coverage.conflicting++;continue;}
  const matches=entries.filter(entry=>entry.concept===concept);
  const second=concept2?entries.filter(entry=>entry.concept===concept2):[];
  if(!matches.length||(concept2&&!second.length)){coverage.unmapped++;continue;}
  if(matches.length!==1||(concept2&&second.length!==1)){coverage.conflicting++;continue;}
  const entry=matches[0],field=fields.find(item=>item.id===entry.fieldId);
  if(concept2){
   const other=fields.find(item=>item.id===second[0].fieldId),pair=[field,other];
   if(pair.some((item,index)=>(index?second[0]:entry).role||!['select','radio','checkboxes'].includes(item.type))){coverage.unsupported++;continue;}
   if(pair.some(item=>item.options.length<2||new Set(item.options).size!==item.options.length||item.options.some(option=>!option.trim()))||!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers)){coverage.conflicting++;continue;}
   const definitions=pair.map(item=>({type:item.type,label:item.label,description:item.description,required:item.required,options:item.options})),id=digest(JSON.stringify(definitions));
   let group=crossTabs.get(id);
   if(!group){
    crossCells+=field.options.length*other.options.length;
    if(crossCells>10000)fail(422,'The cross-tab exceeds 10,000 definition cells. Narrow the filters; no partial analysis was returned.');
    group={id,definitions,eligible:0,answered:0,missing:0,invalid:0,counts:field.options.map(()=>other.options.map(()=>0))};crossTabs.set(id,group);
   }
   group.eligible++;
   const values=pair.map(item=>data.answers[item.id]);
   if(values.some(value=>value==null||value===''||(Array.isArray(value)&&value.length===0))){group.missing++;continue;}
   const selections=pair.map((item,index)=>item.type==='checkboxes'?values[index]:[values[index]]);
   if(selections.some((items,index)=>!Array.isArray(items)||!items.length||new Set(items).size!==items.length||items.some(item=>typeof item!=='string'||!pair[index].options.includes(item)))){group.invalid++;continue;}
   group.answered++;
   for(const left of selections[0])for(const right of selections[1])group.counts[field.options.indexOf(left)][other.options.indexOf(right)]++;
   continue;
  }
  if(entry.role&&entry.role!=='household-size'||!['select','radio','checkboxes','number'].includes(field.type)){coverage.unsupported++;continue;}
  if(field.type!=='number'&&(field.options.length<2||new Set(field.options).size!==field.options.length||field.options.some(option=>!option.trim()))){coverage.conflicting++;continue;}
  if(!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers)){coverage.conflicting++;continue;}
  const definition={type:field.type,label:field.label,description:field.description,required:field.required,options:field.options},id=digest(JSON.stringify(definition));
  let group=groups.get(id);
  if(!group){group={id,type:field.type,label:field.label,options:field.options,eligible:0,answered:0,missing:0,invalid:0,counts:new Map(field.options.map(option=>[option,0])),sum:0,min:null,max:null};groups.set(id,group);}
  group.eligible++;
  const value=data.answers[field.id];
  if(value==null||value===''||(Array.isArray(value)&&value.length===0)){group.missing++;continue;}
  if(field.type==='number'){
   if(typeof value!=='string'&&typeof value!=='number'||typeof value==='string'&&!value.trim()||!Number.isFinite(Number(value))){group.invalid++;continue;}
   const number=Number(value),sum=group.sum+number;
   if(!Number.isFinite(sum)){group.invalid++;continue;}
   group.answered++;group.sum=sum;group.min=group.min===null?number:Math.min(group.min,number);group.max=group.max===null?number:Math.max(group.max,number);
  }else{
   const values=field.type==='checkboxes'?value:[value];
   if(!Array.isArray(values)||!values.length||new Set(values).size!==values.length||values.some(item=>typeof item!=='string'||!group.counts.has(item))){group.invalid++;continue;}
   group.answered++;for(const item of values)group.counts.set(item,group.counts.get(item)+1);
  }
 }
 return {coverage,groups:[...groups.values()].map(group=>({...group,counts:[...group.counts]})),crossTabs:[...crossTabs.values()]};
}
function summarizeAccumulator(accumulator,concept,concept2=''){
 validateConcepts(concept,concept2);
 const {coverage,groups,crossTabs}=accumulator;
 return {concept,...(concept2?{concept2,crossTabs}:{}),coverage,groups:groups.map(({id,type,label,eligible,answered,missing,invalid,counts,sum,min,max})=>({id,type,label,eligible,answered,missing,invalid,...(type==='number'?{min,max,mean:answered?sum/answered:null}:{options:counts.map(([label,count])=>({label,count}))})})),notice:concept2?'Each cell counts responses containing both selected choices in the same submission, divided by responses with valid answers to both questions. Multi-select responses can count in several cells. Exact historical definitions are separate; numeric, text, contact and consent fields are excluded. Indexed coverage is incomplete; counts are not people or attendance.':'Counts are responses, not people or attendance. Percentages use answered responses in each exact question definition; multi-select totals may exceed 100%. Different labels, options, types, descriptions or required settings are separated. Missing, invalid, unmapped, unreviewed and excluded records are not silently included. Indexed coverage is incomplete.'};
}
async function analyse(db,rows,concept,visibleEvents,calendarAllowed,concept2=''){
 validateConcepts(concept,concept2);
 const refs=[...State.versionRefs(db,'source'),...State.versionRefs(db,'index')];
 for(const row of rows){
  if(!validId(row.formId)||!validId(row.responseId)||row.id!==digest(row.formId+':'+row.responseId))fail(409,'An indexed response needs reconciliation; no partial analysis was returned.');
  refs.push(db.doc(`registrationForms/${row.formId}/responses/${row.responseId}`),db.doc(`_registrationInsights/${row.id}`));
 }
 const docs=await documents(db,refs),mappingRefs=[];
 for(const row of rows){
  const index=docs.get(`_registrationInsights/${row.id}`),source=docs.get(`registrationForms/${row.formId}/responses/${row.responseId}`),data=source.data();
  if(!index.exists||index.data().submittedAt!==row.submittedAt||index.data().eventId!==row.eventId)fail(409,'The response index changed. Run analysis again.');
  if(data&&Number.isSafeInteger(data.revision)&&data.revision>0&&data.revision<=999999999)mappingRefs.push(db.doc(`_insightsState/fieldMappings/forms/${row.formId}/revisions/${data.revision}`));
 }
 for(const [path,doc] of await documents(db,mappingRefs))docs.set(path,doc);
 const accumulator=accumulate(emptyAccumulator(),rows,docs,concept,visibleEvents,calendarAllowed,concept2);
 const after=await documents(db,[...docs.values()].map(doc=>doc.ref));
 if(signature(after)!==signature(docs))fail(409,'Source, index or mapping changed while preparing analysis. Run it again.');
 return {...summarizeAccumulator(accumulator,concept,concept2),fingerprint:signature(docs)};
}
module.exports={analyse,validateConcepts,emptyAccumulator,accumulate,summarizeAccumulator};
