export function niazProgrammeDate(startAt){
 const date=new Date(startAt);
 if(!startAt||!Number.isFinite(date.getTime()))return '';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return `${value.year}-${value.month}-${value.day}`;
}
export function niazOfferUrl(eventId,startAt){
 const date=niazProgrammeDate(startAt);
 if(!date||!validEventId(eventId))return '/niaz/';
 return '/niaz/?'+new URLSearchParams({event:eventId,date}).toString();
}
function validEventId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);}
export function parseNiazProgrammeLink(search){
 const params=new URLSearchParams(search),eventId=params.get('event'),date=params.get('date');
 const requested=params.has('event')||params.has('date');
 const parsed=date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T00:00:00Z'):null;
 const valid=validEventId(eventId)&&!!parsed&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date&&params.getAll('event').length===1&&params.getAll('date').length===1;
 return {requested,valid,eventId:valid?eventId:null,date:valid?date:null};
}
