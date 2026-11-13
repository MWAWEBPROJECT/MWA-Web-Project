const {audienceError,venueConflictReason}=require('./venuePolicy');
const {rangesOverlapBuffered}=require('./conflictUtils');
// Availability only: never return event IDs, titles, contacts, notes or audience fields.
function venueAvailability(venues,events,audience,range){
 const byId=new Map(venues.map(v=>[v.id,v]));
 return venues.map(v=>{
  const restriction=audienceError(v,audience);
  const busy=events.filter(e=>['confirmed','pending'].includes(e.status)&&venueConflictReason({venueId:v.id,audience},e,v,byId.get(e.venueId))&&rangesOverlapBuffered(range.from,range.to,e.startAt,e.endAt,e._buf||0)).map(e=>({start:e.startAt,end:new Date(Date.parse(e.endAt)+Math.max(0,e._buf||0)*3600000).toISOString(),reason:venueConflictReason({venueId:v.id,audience},e,v,byId.get(e.venueId))}));
  return {venueId:v.id,restriction,busy};
 });
}
module.exports={venueAvailability};
