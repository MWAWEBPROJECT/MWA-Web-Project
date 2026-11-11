const {dateKey,midnight}=require('./donation-records');
function programmeWindow(period,now=new Date()){
 const today=dateKey(now),day=new Date(today+'T12:00:00Z');
 if(period!=='today')day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7)+(period==='next-week'?7:0));
 const start=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+(period==='today'?1:7));
 const end=day.toISOString().slice(0,10);
 return {start,end,from:new Date(midnight(start)).toISOString(),to:new Date(midnight(end)).toISOString()};
}
async function programmeAnswer(db,period,now=new Date()){
 const range=programmeWindow(period,now),link={id:'public-programmes',title:'Open public programme calendar',href:'/#events'};
 try{
  const snapshot=await db.collection('events').where('startAt','>=',range.from).where('startAt','<',range.to).orderBy('startAt').select('title','startAt','status','departmentName','visibility','masked').limit(201).get();
  const rows=snapshot.docs.map(doc=>doc.data()).filter(e=>e.status==='confirmed'&&!e.masked&&e.visibility!=='private'&&String(e.departmentName||'').trim().toLowerCase()==='mwa programs');
  const label=period==='today'?'today':period==='next-week'?'next week':'this week';
  const format=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
  const lines=rows.slice(0,8).map(e=>String(e.title||'MWA programme').slice(0,160)+' — '+format.format(new Date(e.startAt)));
  const more=rows.length>8||snapshot.size===201;
  return {answer:lines.length?'Public MWA programmes '+label+' ('+range.start+'; Sydney time'+(period==='today'?'':', Monday–Sunday')+'):\n\n'+lines.join('\n\n')+(more?'\n\nShowing a limited list. Open the calendar for all programmes.':''):(snapshot.size===201?'The programme list is too large to check completely. Please open the calendar.':'No confirmed public MWA programmes are listed for '+label+'.'),links:[link]};
 }catch{return {answer:'I could not refresh the public programme list. Please open the calendar or try again shortly.',links:[link]};}
}
module.exports={programmeWindow,programmeAnswer};
