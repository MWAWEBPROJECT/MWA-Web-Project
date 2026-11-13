const AUDIENCES={family:'Family Event',gents:'Gents only',ladies:'Ladies only',kids:'Kids only'};
function normalizeAudience(value){if(value===undefined||value===null||value==='')return 'family';if(typeof value!=='string'||!Object.hasOwn(AUDIENCES,value))throw Error('Choose Family Event, Gents only, Ladies only or Kids only.');return value;}
module.exports={AUDIENCES,normalizeAudience};
