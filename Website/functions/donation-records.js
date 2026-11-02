const normalize=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
function mobile(v){let n=String(v||'').replace(/[\s().-]/g,'');if(/^04\d{8}$/.test(n))n='+61'+n.slice(1);if(/^614\d{8}$/.test(n))n='+'+n;return n;}
const reference=id=>'MWA-'+id.toUpperCase();
function searchKeys(d,id){const keys=new Set([normalize(id),normalize(reference(id)),normalize(d.email),normalize(d.originalEmail),normalize(d.testEmail),normalize(d.customerId)]);const phone=mobile(d.mobile);if(phone)keys.add(phone);const name=normalize(d.name);for(let i=2;i<=Math.min(name.length,100);i++)keys.add(name.slice(0,i));return [...keys].filter(Boolean);}
function searchTerm(v){const s=normalize(v);return /^[+\d\s().-]+$/.test(s)?mobile(s):s;}
function indexFields(d,id){return {searchKeys:searchKeys(d,id),recurringMode:d.recurring?'recurring':'once',recordVersion:2};}
function publicEvent(d,id){if(d?.status!=='confirmed'||!(d.visibility==='public'||normalize(d.departmentName)==='mwa programs'))return null;return {id,title:d.title||'MWA programme',startAt:d.startAt,venueName:d.venueName||''};}
function dateKey(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function midnight(date){if(!validDate(date))throw Object.assign(Error('Choose valid dates.'),{status:400});let ms=Date.parse(date+'T00:00:00Z');for(let i=0;i<3;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));ms-=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)-Date.parse(date+'T00:00:00Z');}return ms;}
async function eventForDonation(db,niaz){if(niaz?.scope!=='event')return niaz;const snap=await db.doc('events/'+niaz.eventId).get(),event=publicEvent(snap.data(),niaz.eventId);if(!event||dateKey(event.startAt)!==niaz.date)throw Object.assign(Error('That event is no longer available on the selected date. Please choose again.'),{status:400});return {...niaz,title:event.title,startAt:event.startAt};}
async function eventList(db,date){const from=new Date(midnight(date)).toISOString();const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);const to=new Date(midnight(next)).toISOString();const snap=await db.collection('events').where('startAt','>=',from).where('startAt','<',to).get();return snap.docs.map(d=>publicEvent(d.data(),d.id)).filter(Boolean);}
async function listRecords(db,params){
 for(const key of ['from','to'])if(params[key]&&!validDate(params[key]))throw Object.assign(Error('Choose valid dates.'),{status:400});
 let q=db.collection('_stripeSandboxDonations');const term=searchTerm(params.search||'');if(term.length>254)throw Object.assign(Error('Search is too long.'),{status:400});if(term)q=q.where('searchKeys','array-contains',term);
 for(const key of ['fund','recurringMode','status'])if(params[key])q=q.where(key,'==',String(params[key]));
 if(params.from)q=q.where('createdAt','>=',midnight(params.from));if(params.to){const next=new Date(Date.parse(params.to+'T12:00:00Z')+86400000).toISOString().slice(0,10);q=q.where('createdAt','<',midnight(next));}
 if(params.from&&params.to&&params.from>params.to)throw Object.assign(Error('The end date must be after the start date.'),{status:400});
 q=q.orderBy('createdAt','desc').orderBy('__name__','desc');
 if(params.after){let c;try{c=JSON.parse(Buffer.from(String(params.after),'base64url').toString());}catch{}if(!c||!Number.isFinite(c.t)||!/^[-a-f0-9]{36}$/.test(c.id))throw Object.assign(Error('Invalid page.'),{status:400});q=q.startAfter(c.t,c.id);}
 const snap=await q.limit(51).get(),docs=snap.docs.slice(0,50),last=docs.at(-1);
 return {items:docs.map(doc=>{const d=doc.data();return {id:doc.id,reference:reference(doc.id),createdAt:d.createdAt,name:d.name||'',mobile:d.mobile||'',email:d.email||d.testEmail||'',originalEmail:d.originalEmail||'',notes:d.notes||'',fund:d.fund,amount:d.amount,status:d.status,niaz:d.niaz||null,khums:d.khums||null,recurring:d.recurring,recurringStatus:d.recurringStatus,canCancel:!!d.scheduleId&&!['canceled','aborted','completed'].includes(d.recurringStatus)};}),next:snap.size>50?Buffer.from(JSON.stringify({t:last.data().createdAt,id:last.id})).toString('base64url'):null};
}
module.exports={mobile,reference,searchKeys,searchTerm,indexFields,publicEvent,dateKey,validDate,midnight,eventForDonation,eventList,listRecords};
