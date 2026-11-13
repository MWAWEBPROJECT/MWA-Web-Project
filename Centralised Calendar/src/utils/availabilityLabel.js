// Display free windows only. Booking reasons and buffer policy stay internal.
const clock=ms=>new Date(ms).toLocaleTimeString('en-AU',{timeZone:'Australia/Sydney',hour:'numeric',minute:'2-digit',hour12:true});
export function availabilityLabel(item,from,to){
 if(item.restriction)return 'Not available';
 const start=Date.parse(from),end=Date.parse(to);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 'Availability could not be checked';
 const busy=(item.busy||[]).map(b=>[Math.max(start,Date.parse(b.start)),Math.min(end,Date.parse(b.end))]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
 const free=[];let cursor=start;
 for(const [a,b] of busy){if(a>cursor)free.push([cursor,a]);cursor=Math.max(cursor,b);}
 if(cursor<end)free.push([cursor,end]);
 if(!free.length)return 'Not available';
 if(free.length===1){const [a,b]=free[0];if(a===start&&b===end)return 'Available';if(b===end)return 'Available from '+clock(a);if(a===start)return 'Available until '+clock(b);return 'Available '+clock(a)+' – '+clock(b);}
 return 'Available: '+free.map(([a,b])=>b===end?'from '+clock(a):clock(a)+' – '+clock(b)).join('; ');
}
