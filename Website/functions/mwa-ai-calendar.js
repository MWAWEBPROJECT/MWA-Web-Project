const C=require('./generated/calendar-runtime.cjs');
const {dateKey,validDate}=require('./donation-records');
const disclaimer='Hijri dates follow MWA Calendar Management and its saved moon-sighting adjustments. Dates may change following local moon sighting; future dates are provisional.';
const links=[{id:'prayer-calendar',title:'Open prayer times and calendar',href:'/#today-panels'}];
function resolveDate(value,now=new Date()){
 const today=dateKey(now);let date=value;
 if(value==='today')date=today;
 if(value==='tomorrow'){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);date=d.toISOString().slice(0,10);}
 if(/^\d{2}-\d{2}$/.test(value||'')){date=today.slice(0,4)+'-'+value;if(date<today)date=String(Number(today.slice(0,4))+1)+'-'+value;}
 if(!validDate(date)||Number(date.slice(0,4))<1900||Number(date.slice(0,4))>2100)return null;
 return date;
}
function time(value){if(!/^\d{2}:\d{2}$/.test(value||''))throw Error('Unavailable calculation');const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`;}
async function calendarAnswer(db,request,now=new Date()){
 const kind=request.calendarKind;
 try{
  if(kind==='prayer'){
   const date=resolveDate(request.calendarDate,now);if(!date)return {answer:'Please give a valid Gregorian date, including the year, for the prayer time.',links};
   const times=C.calculatePrayerTimes(date),labels={fajr:'Fajr',zohrain:'Zuhr',maghreb:'Maghrib',sunrise:'Sunrise',sunset:'Sunset',asr:'Asr',isha:'Isha'};
   const keys=request.prayerName==='all'?['fajr','zohrain','maghreb','sunrise','sunset']:[request.prayerName];
   if(keys.some(key=>!labels[key]))return {answer:'Which prayer time would you like: Fajr, Zuhr or Maghrib?',links};
   return {answer:`Kemps Creek NSW 2178 — ${date} (Australia/Sydney local time):\n\n`+keys.map(key=>labels[key]+': '+time(times[key])).join('\n')+'\n\nCalculated using the same method as the MWA prayer panel. These are prayer start times, not congregation times.'+(/^\d{2}-\d{2}$/.test(request.calendarDate)?' No year was given, so I used the next occurrence of that date.':''),links};
  }
  const snapshot=await db.doc('calendarSettings/hijri').get(),overrides=snapshot.exists?(snapshot.data().overrides||[]):[];
  if(!Array.isArray(overrides))throw Error('Invalid calendar settings');
  if(kind==='gregorian-to-hijri'){
   const date=resolveDate(request.calendarDate,now);if(!date)return {answer:'Please give a valid Gregorian date, including the year, to convert.',links};
   const h=C.getHijriParts(date,overrides);if(!h.year)throw Error('Invalid conversion');
   return {answer:`${date} Gregorian = ${h.day} ${C.HIJRI_MONTHS.find(m=>m.value===h.month).name} ${h.year} AH.\n\n`+disclaimer+(/^\d{2}-\d{2}$/.test(request.calendarDate)?' No year was given, so I used the next occurrence.':''),links};
  }
  if(kind==='hijri-to-gregorian'){
   const parts=/^(\d{4})-(\d{2})-(\d{2})$/.exec(request.calendarDate||'');
   if(!parts)return {answer:'Please include the Hijri day, month and year (AH), so I can use the correct MWA calendar settings.',links};
   const [,year,month,day]=parts.map(Number);
   if(year<1200||year>1600||month<1||month>12||day<1||day>C.getHijriMonthLength(year,month,overrides))return {answer:'That Hijri date is not valid in the MWA calendar. Please check its day, month and year.',links};
   const g=C.adjustedIslamicToGregorian(year,month,day,overrides),date=`${g.year}-${String(g.month).padStart(2,'0')}-${String(g.day).padStart(2,'0')}`;
   return {answer:`${day} ${C.HIJRI_MONTHS.find(m=>m.value===month).name} ${year} AH = ${date} Gregorian.\n\n`+disclaimer,links};
  }
  return {answer:'Please specify the date and which calendar you want to convert from.',links};
 }catch{return {answer:'I could not read the current calendar settings or calculate that time. Please check the MWA calendar or try again shortly.',links};}
}
module.exports={resolveDate,calendarAnswer};
