const {createHash}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const Snapshot=require('./insights-multi-snapshot');

const MAX_EVENTS=5000,MAX_SCOPE_BYTES=700000;
const entry=doc=>doc.id+'\0'+Snapshot.stamp(doc);
const fingerprint=entries=>createHash('sha256').update(JSON.stringify(entries.map(value=>value.split('\0')).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
const query=(db,from,to)=>db.collection('events').where('startAt','>=',from).where('startAt','<',to).orderBy('startAt').orderBy(FieldPath.documentId());
function checkCapacity(entries,eventIds){
 if(entries.length>MAX_EVENTS||Buffer.byteLength(JSON.stringify({calendarEntries:entries,eventIds}),'utf8')>MAX_SCOPE_BYTES)throw Object.assign(Error('This analysis exceeds its calendar capacity. Narrow the date range; no partial report is available.'),{status:422});
}
module.exports={MAX_EVENTS,entry,fingerprint,query,checkCapacity};
