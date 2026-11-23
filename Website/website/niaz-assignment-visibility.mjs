export function visibleAssignments(assignments,eventIds,sponsorIds){
 const approved=(assignments||[]).filter(row=>row.status==='approved');
 if(eventIds.length)return approved.filter(row=>eventIds.includes(row.eventId));
 if(sponsorIds.length)return approved.filter(row=>sponsorIds.includes(row.sponsorId));
 return [];
}
