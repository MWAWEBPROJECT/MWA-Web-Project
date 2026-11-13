// Run from repository root. Dry-run by default; --apply requires --expected-hash=<dry-run hash>.
// MWA_READ_TOKEN must come from gcloud; never store it. Backups contain selected scheduling fields only.
const fs=require('node:fs'),crypto=require('node:crypto');
const {computeAllConflicts}=require('../functions/conflictUtils');
const {venueKind}=require('../functions/venuePolicy');
const project='project-7a4fb531-414f-4ade-88e',root=`projects/${project}/databases/(default)/documents`,base='https://firestore.googleapis.com/v1/'+root;
const decode=v=>v?.stringValue??v?.booleanValue??(v?.integerValue!==undefined?Number(v.integerValue):v?.doubleValue??(v?.arrayValue?(v.arrayValue.values||[]).map(decode):null));
const encode=v=>typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):typeof v==='boolean'?{booleanValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{stringValue:String(v)};
async function call(url,body){const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+process.env.MWA_READ_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Firestore request failed '+r.status);return r.json();}
async function read(name,fields){const rows=await call(base+':runQuery',{structuredQuery:{from:[{collectionId:name}],select:{fields:fields.map(fieldPath=>({fieldPath}))},limit:2000}});const docs=rows.filter(r=>r.document).map(r=>({id:r.document.name.split('/').pop(),updateTime:r.document.updateTime,...Object.fromEntries(Object.entries(r.document.fields||{}).map(([k,v])=>[k,decode(v)]))}));if(docs.length>=2000)throw Error('Read limit reached; review pagination before migrating');return docs;}
(async()=>{
 if(!process.env.MWA_READ_TOKEN)throw Error('MWA_READ_TOKEN required');
 const venues=await read('venues',['name','bufferHours','bufferMinutes','coversAllVenues']);
 const events=await read('events',['departmentName','startAt','endAt','venueId','audience','status','hasConflict','conflictWith']);
 const day=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
 const exceptions={'2026-11-14':'ladies','2026-12-06':'ladies','2026-11-27':'gents','2026-11-28':'gents'};
 const targets=events.filter(e=>e.departmentName==='MWA Programs');
 for(const date of Object.keys(exceptions))if(targets.filter(e=>day(e.startAt)===date).length!==1)throw Error('Expected exactly one MWA programme on '+date+'; manual review required');
 const desired=new Map(targets.map(e=>[e.id,exceptions[day(e.startAt)]||'family']));
 const venueChanges=venues.map(v=>({id:v.id,updateTime:v.updateTime,before:v,patch:{bufferHours:venueKind(v)==='precinct'?8:venueKind(v)==='shed'?6:['main','hall2','hall3','hall4','hall5','hall6'].includes(venueKind(v))?5:v.bufferHours}})).filter(v=>v.patch.bufferHours!==v.before.bufferHours).sort((a,b)=>a.id.localeCompare(b.id));
 const nextVenues=venues.map(v=>({...v,...(venueChanges.find(c=>c.id===v.id)?.patch||{})}));
 const next=events.map(e=>desired.has(e.id)?{...e,audience:desired.get(e.id)}:e),conflicts=computeAllConflicts(next,nextVenues);
 const changes=[];
 for(const e of events){const patch={};if(desired.has(e.id)&&e.audience!==desired.get(e.id))patch.audience=desired.get(e.id);if(conflicts.has(e.id)){const ids=conflicts.get(e.id).sort();if(Boolean(e.hasConflict)!==Boolean(ids.length)||JSON.stringify([...(e.conflictWith||[])].sort())!==JSON.stringify(ids)){patch.hasConflict=!!ids.length;patch.conflictWith=ids;}}if(Object.keys(patch).length)changes.push({id:e.id,updateTime:e.updateTime,before:e,patch});}
 changes.sort((a,b)=>a.id.localeCompare(b.id));
 const hash=crypto.createHash('sha256').update(JSON.stringify({changes,venueChanges})).digest('hex');
 const summary={venueChanges:venueChanges.length,buffers:nextVenues.map(v=>({name:v.name,hours:v.bufferHours})),programmes:targets.length,counts:next.filter(e=>desired.has(e.id)).reduce((m,e)=>(m[e.audience]=(m[e.audience]||0)+1,m),{}),changed:changes.length,audienceChanges:changes.filter(e=>e.patch.audience).length,conflictChanges:changes.filter(e=>'hasConflict'in e.patch).length,hash};console.log(JSON.stringify(summary));
 const backup=process.env.MWA_AUDIENCE_BACKUP;if(!backup)throw Error('Set MWA_AUDIENCE_BACKUP to a local JSON file');fs.writeFileSync(backup,JSON.stringify({summary,changes,venueChanges},null,2));
 if(!process.argv.includes('--apply'))return;
 const expected=process.argv.find(a=>a.startsWith('--expected-hash='))?.split('=')[1];if(expected!==hash)throw Error('Plan changed; review a new dry-run');
 if(!changes.length&&!venueChanges.length)return;
 if((changes.length+venueChanges.length)*2>450)throw Error('Too many writes; use reviewed transaction batches');
 const stamp=new Date().toISOString(),writes=[];
 for(const change of [...changes.map(c=>({...c,collection:'events'})),...venueChanges.map(c=>({...c,collection:'venues'}))]){writes.push({update:{name:root+'/'+change.collection+'/'+change.id,fields:Object.fromEntries(Object.entries(change.patch).map(([k,v])=>[k,encode(v)]))},updateMask:{fieldPaths:Object.keys(change.patch)},currentDocument:{updateTime:change.updateTime},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]});writes.push({update:{name:root+'/auditLog/'+crypto.randomUUID(),fields:Object.fromEntries(Object.entries({module:'events-bookings',entityType:change.collection==='venues'?'venue':'event',entityId:change.id,action:'audience_policy_migration',userEmail:'sajjadzaheer@gmail.com',timestamp:stamp,note:'EC-approved venue policy and user-requested 2026 programme audience defaults and requested venue buffers; updated '+Object.keys(change.patch).join(', ')}).map(([k,v])=>[k,encode(v)]))},currentDocument:{exists:false}});}
 await call(base+':commit',{writes});console.log('Applied atomically with update-time preconditions and per-record audit entries. No emails requested.');
})().catch(error=>{console.error(error.message);process.exitCode=1});
