// Read-only capability facade for assistant fact tools. No arbitrary collection,
// document, field, unbounded query or mutation API is available to these tools.
const fields={events:['title','startAt','startPrayer','status','departmentName','visibility','masked'],keyIslamicEvents:['name','month','day','category','enabled']};
const deny=()=>{throw Error('MWA Khadim supports public information only');};
function publicReader(db){return Object.freeze({
 doc(path){if(path!=='calendarSettings/hijri')return deny();return Object.freeze({async get(){const snap=await db.doc(path).get();return {exists:snap.exists,data:()=>({overrides:snap.exists?snap.data().overrides||[]:[]})};}});},
 collection(name){if(!Object.hasOwn(fields,name))return deny();let query=db.collection(name),selected=false,bounded=false;const limits=new Set();
  const chain={where(field,op,value){if(name!=='events'||field!=='startAt'||!['>=','<'].includes(op)||typeof value!=='string'||!Number.isFinite(Date.parse(value)))return deny();limits.add(op);query=query.where(field,op,value);return chain;},
   orderBy(field){if(field!=='startAt'||name!=='events')return deny();query=query.orderBy(field);return chain;},
   select(...names){if(!names.length||names.some(field=>!fields[name].includes(field)))return deny();selected=true;query=query.select(...fields[name]);return chain;},
   limit(n){if(!Number.isInteger(n)||n<1||n>501)return deny();bounded=true;query=query.limit(n);return chain;},
   async get(){if(!selected||!bounded||(name==='events'&&(!limits.has('>=')||!limits.has('<'))))return deny();const snap=await query.get();const docs=snap.docs.map(doc=>doc.data()).filter(row=>name==='events'?row.status==='confirmed'&&!row.masked&&row.visibility!=='private'&&String(row.departmentName||'').trim().toLowerCase()==='mwa programs':row.enabled!==false).map(row=>({data:()=>Object.fromEntries(fields[name].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))}));return {docs,size:snap.size};}
  };return Object.freeze(chain);
 }
});}
module.exports={publicReader};
