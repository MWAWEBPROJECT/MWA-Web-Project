// Kept in parity with functions/venuePolicy.js by venuePolicy.test.js.
// Approved EC matrix, 13 November 2026. Time overlap is handled separately.
function venueKind(v){
 if(!v)return 'other';
 if(v.coversAllVenues===true||v.coversAllVenues!==false&&/\b(entire|whole)\b/i.test(v.name||''))return 'precinct';
 if(/\bmain\s+hall\b/i.test(v.name||''))return 'main';
 const match=String(v.name||'').match(/\bhall\s*([2-6])\b/i);return match?'hall'+match[1]:/\bshed\b/i.test(v.name||'')?'shed':'other';
}
function audienceError(venue,audience='family'){return ['hall4','hall5','hall6'].includes(venueKind(venue))&&audience!=='ladies'?'Halls 4, 5 and 6 are available for Ladies only programmes.':'';}
function venueConflictReason(a,b,va,vb){
 const ak=venueKind(va),bk=venueKind(vb),aa=a.audience||'family',ba=b.audience||'family';
 if(ak==='precinct'||bk==='precinct')return 'Entire MWA Precinct booking';
 if(a.venueId===b.venueId)return 'Existing booking at this venue';
 const halls=['main','hall2','hall3','hall4','hall5','hall6'];
 if(ak==='main'&&aa==='ladies'&&halls.includes(bk)||bk==='main'&&ba==='ladies'&&halls.includes(ak))return 'Ladies programme in Main Hall reserves all halls';
 const downstairs=['main','hall2','hall3'],lower=['hall2','hall3'];
 if(downstairs.includes(ak)&&aa==='ladies'&&lower.includes(bk)&&ba!=='ladies'||downstairs.includes(bk)&&ba==='ladies'&&lower.includes(ak)&&aa!=='ladies')return 'Ladies programme downstairs restricts Halls 2 and 3 to ladies';
 return '';
}
export {venueKind,audienceError,venueConflictReason};
