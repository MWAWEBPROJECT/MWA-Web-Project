const {createHash}=require('node:crypto');

const SHARDS=16,MAX_ENTRIES=600;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const stamp=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
const allowed=path=>/^events\/[A-Za-z0-9_-]{1,128}$/.test(path)||/^_insightsState\/programmeAssignments\/events\/[A-Za-z0-9_-]{1,128}$/.test(path)||/^_insightsState\/programmeCategories\/items\/[A-Za-z0-9_-]{1,128}$/.test(path);
const shard=path=>createHash('sha256').update(path).digest().readUInt32BE(0)%SHARDS;
const refs=jobRef=>Array.from({length:SHARDS},(_,i)=>jobRef.collection('ledger').doc(String(i).padStart(2,'0')));

async function prepare(tx,jobRef,docs,previousCount=0){
 if(!Number.isSafeInteger(previousCount)||previousCount<0||previousCount>MAX_ENTRIES)fail(409,'Analysis ledger is invalid. Start again.');
 const incoming=new Map();
 for(const doc of docs){
  const path=doc.ref.path,value=stamp(doc);
  if(!allowed(path))fail(409,'Analysis ledger contains an unsupported reference.');
  if(incoming.has(path)&&incoming.get(path)!==value)fail(409,'Calendar or programme reviews changed. Start again.');
  incoming.set(path,value);
 }
 const grouped=new Map();
 for(const [path,value] of incoming){const n=shard(path);if(!grouped.has(n))grouped.set(n,[]);grouped.get(n).push([path,value]);}
 const allRefs=refs(jobRef),indices=[...grouped.keys()],saved=indices.length?await tx.getAll(...indices.map(i=>allRefs[i])):[];
 let count=previousCount;const updates=[];
 for(let i=0;i<indices.length;i++){
  const entries={...(saved[i].data()?.entries||{})};
  for(const [path,value] of grouped.get(indices[i])){
   if(Object.hasOwn(entries,path)&&entries[path]!==value)fail(409,'Calendar or programme reviews changed. Start again.');
   if(!Object.hasOwn(entries,path)){entries[path]=value;count++;}
  }
  updates.push({ref:allRefs[indices[i]],entries});
 }
 if(count>MAX_ENTRIES)fail(422,`This analysis exceeds ${MAX_ENTRIES} calendar and programme ledger entries. Narrow the scope; no partial report is available.`);
 return {count,write:()=>{for(const update of updates)tx.set(update.ref,{entries:update.entries});}};
}

async function validate(tx,db,jobRef,count){
 if(!Number.isSafeInteger(count)||count<0||count>MAX_ENTRIES)fail(409,'Analysis ledger is invalid. Start again.');
 const chunks=await tx.getAll(...refs(jobRef)),entries=chunks.flatMap(doc=>Object.entries(doc.data()?.entries||{}));
 if(entries.length!==count||new Set(entries.map(([path])=>path)).size!==count||entries.some(([path,value])=>!allowed(path)||typeof value!=='string'))fail(409,'Analysis ledger is incomplete. Start again.');
 for(let offset=0;offset<entries.length;offset+=200){
  const batch=entries.slice(offset,offset+200),docs=await tx.getAll(...batch.map(([path])=>db.doc(path)));
  if(docs.some((doc,i)=>stamp(doc)!==batch[i][1]))fail(409,'Calendar or programme reviews changed. Start again.');
 }
}
module.exports={prepare,validate,MAX_ENTRIES};
