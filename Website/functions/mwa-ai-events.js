const C=require('./generated/calendar-runtime.cjs');
const {dateKey,midnight}=require('./donation-records');
const {resolveDate}=require('./mwa-ai-calendar');
const programmeLink={id:'public-programmes',title:'Open MWA programme calendar',href:'/#events'};
const islamicLink={id:'islamic-dates',title:'Open Key Islamic Dates',href:'/islamic-events/'};
const moon='Hijri dates follow MWA Calendar Management and saved moon sightings. Future dates are provisional and may change after local moon sighting. An observance date is not necessarily the date of its MWA programme.';
function words(value){return [...new Set(String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).map(w=>({wiladat:'birth',wiladah:'birth',birthday:'birth',births:'birth',milad:'birth',meelad:'birth',milaad:'birth',martyrdom:'shahadat',shahadah:'shahadat',raza:'rida',reza:'rida'}[w]||w)).filter(w=>w&&!['a','s','as','sa','ra','pbuh','saww','ajtf','of','the','anniversary','hazrat','sayyid','syed','al'].includes(w)))];}
function matches(rows,query,title){const terms=words(query);if(!terms.length)return rows;const selected=rows.filter(row=>{const tokens=words(title(row));return terms.every(term=>tokens.includes(term));});const exact=selected.filter(row=>words(title(row)).length===terms.length);return exact.length?exact:selected;}
const addDays=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const formatDate=date=>new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
function startDescription(event){
 const time=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',hour:'numeric',minute:'2-digit'}).format(new Date(event.startAt));
 const p=event.startPrayer,key=typeof p==='string'?p:p?.key,offset=typeof p==='object'?Number(p?.offset||0):0;
 const name={fajr:'Fajr',zohrain:'Zuhrain',asr:'Asr',maghreb:'Maghrebain',isha:'Isha'}[key];
 if(name&&Number.isFinite(offset)&&Math.abs(offset)<=360)return (offset>0?`${offset} minutes after ${name}`:offset<0?`${Math.abs(offset)} minutes before ${name}`:`at ${name}`)+` (calendar start: ${time}, Sydney time)`;
 return `at ${time} Sydney time (fixed start time)`;
}
async function programmeSearch(db,value,now){
 const query=typeof value.eventQuery==='string'?value.eventQuery.trim().slice(0,160):'',requested=value.eventDate?resolveDate(value.eventDate,now):null;
 if(value.eventDate&&!requested)return {answer:'Please give a valid Gregorian programme date, including the year if possible.',links:[programmeLink]};
 if(!query&&!requested)return {answer:'Which MWA programme or date would you like me to check?',links:[programmeLink]};
 const today=dateKey(now),from=requested?addDays(requested,query?-7:0):today,to=requested?addDays(requested,query?8:1):addDays(today,366);
 const snap=await db.collection('events').where('startAt','>=',new Date(midnight(from)).toISOString()).where('startAt','<',new Date(midnight(to)).toISOString()).orderBy('startAt').select('title','startAt','startPrayer','status','departmentName','visibility','masked').limit(501).get();
 const rows=snap.docs.map(d=>d.data()).filter(e=>e.status==='confirmed'&&!e.masked&&e.visibility!=='private'&&String(e.departmentName||'').trim().toLowerCase()==='mwa programs'&&Number.isFinite(Date.parse(e.startAt)));
 const found=matches(rows,query,e=>e.title),onDate=requested?found.filter(e=>dateKey(e.startAt)===requested):found;
 let chosen=onDate,lead='';
 if(!onDate.length&&found.length===1&&snap.size<501){chosen=found;lead=`I found this programme on ${formatDate(dateKey(found[0].startAt))}, rather than ${formatDate(requested)}:\n\n`;}
 else if(!onDate.length&&found.length>1){chosen=found;lead='I found several nearby matches. Which programme do you mean?\n\n';}
 else if(onDate.length>1&&query)lead='I found more than one matching programme. Which one do you mean?\n\n';
 if(!chosen.length)return {answer:(snap.size>=501?'There are too many programmes to check this range completely. Please narrow the date or programme name.':`I could not find a matching confirmed public MWA programme ${requested?'on '+formatDate(requested)+' or within seven days of it':'between '+formatDate(from)+' and '+formatDate(addDays(to,-1))}.`),links:[programmeLink]};
 const lines=chosen.slice(0,5).map(e=>`${String(e.title||'MWA programme').slice(0,180)} — ${formatDate(dateKey(e.startAt))}\nStarts ${startDescription(e)}.`);
 return {answer:lead+lines.join('\n\n')+(chosen.length>5||snap.size>=501?'\n\nShowing a limited list; narrow the date or open the calendar for more.':'')+(value.eventDate&&/^\d{2}-\d{2}$/.test(value.eventDate)?'\n\nNo year was supplied; I searched around the next occurrence of that date.':''),links:[programmeLink]};
}
async function islamicSearch(db,value,now){
 const query=typeof value.eventQuery==='string'?value.eventQuery.trim().slice(0,160):'';
 if(!query)return {answer:'Which Islamic occasion would you like me to look up?',links:[islamicLink]};
 const [snap,settings]=await Promise.all([db.collection('keyIslamicEvents').select('name','month','day','category','enabled').limit(501).get(),db.doc('calendarSettings/hijri').get()]);
 const overrides=settings.exists?(settings.data().overrides||[]):[],today=dateKey(now),current=C.getHijriParts(today,overrides).year;
 if(!Array.isArray(overrides)||!current)throw Error('Invalid calendar settings');
 const year=Number(value.eventYear||0);if(year&&(!Number.isInteger(year)||!(year>=1200&&year<=1600||year>=1900&&year<=2100)))return {answer:'Please specify a supported Gregorian year (1900–2100) or Hijri year (1200–1600 AH).',links:[islamicLink]};
 const rows=matches(snap.docs.map(d=>d.data()).filter(e=>e.enabled!==false&&Number.isInteger(e.month)&&e.month>=1&&e.month<=12&&Number.isInteger(e.day)&&e.day>=1&&e.day<=30),query,e=>e.name+' '+(e.category==='Wiladat'?'birth':''));
 if(!rows.length)return {answer:snap.size>=501?'The Key Islamic Dates list is too large to check completely. Please open it to refine your search.':'I could not find that occasion in MWA’s Key Islamic Dates. Please try its full name.',links:[islamicLink]};
 const results=[];
 for(const row of rows){const base=year>=1900?C.getHijriParts(year+'-01-01',overrides).year:year||current;const years=year>=1900?[base,base+1,base+2]:year?[year]:[base,base+1];
  const occurrences=years.filter(y=>row.day<=C.getHijriMonthLength(y,row.month,overrides)).map(y=>{const g=C.adjustedIslamicToGregorian(y,row.month,row.day,overrides);return {year:y,date:`${g.year}-${String(g.month).padStart(2,'0')}-${String(g.day).padStart(2,'0')}`};}).filter(o=>year>=1900?o.date.startsWith(year+'-'):year?true:o.date>=today);
  for(const occurrence of (year?occurrences:occurrences.slice(0,1)))results.push(`${String(row.name).slice(0,180)}\n${row.day} ${C.HIJRI_MONTHS.find(m=>m.value===row.month).name} ${occurrence.year} AH — ${formatDate(occurrence.date)}`);
 }
 return {answer:(results.length?(rows.length>1?'Matching Islamic occasions:\n\n':'')+results.slice(0,5).join('\n\n'):'That date does not occur in the selected year under the current MWA calendar settings.')+(results.length>5||snap.size>=501?'\n\nShowing a limited list.':'')+'\n\n'+moon,links:[islamicLink]};
}
async function eventAnswer(db,value,now=new Date()){
 try{return value.eventKind==='islamic'?await islamicSearch(db,value,now):await programmeSearch(db,value,now);}catch{return {answer:'I could not refresh the MWA calendar data. Please try again shortly; I cannot confirm a date or time without it.',links:[value.eventKind==='islamic'?islamicLink:programmeLink]};}
}
module.exports={eventAnswer,matches,startDescription};
