export function visibleAssignments(assignments,eventIds,sponsorIds){
 const approved=(assignments||[]).filter(row=>row.status==='approved');
 if(eventIds.length)return approved.filter(row=>eventIds.includes(row.eventId));
 if(sponsorIds.length)return approved.filter(row=>sponsorIds.includes(row.sponsorId));
 return [];
}
export function assignedSponsorIds(assignments,eventIds){
 const events=new Set(eventIds);
 return new Set((assignments||[]).filter(row=>row.status==='approved'&&events.has(row.eventId)).map(row=>row.sponsorId));
}
export function visibleSponsorRows(sponsors,{query='',status='',selectedIds=new Set(),assignedIds=new Set()}={}){
 const term=query.trim().toLowerCase();
 const pinned=row=>selectedIds.has(row.id)||assignedIds.has(row.id);
 const rank=row=>selectedIds.has(row.id)?2:assignedIds.has(row.id)?1:0;
 return (sponsors||[]).filter(row=>pinned(row)||(!term||[row.name,row.email,row.phone].join(' ').toLowerCase().includes(term))&&(!status||(status==='active'?row.active===true:row.active!==true)))
  .sort((a,b)=>rank(b)-rank(a)||a.name.localeCompare(b.name));
}
