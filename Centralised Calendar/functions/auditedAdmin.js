const { FieldPath } = require('firebase-admin/firestore');
const { auditEntry, changedValues, validDate, auditFilters, matchesAudit } = require('./auditModel');
const CATEGORIES = ['Wiladat','Shahadat','Wafat','Eid','Ayyam-e-Aza','Amaal','Season','Event'];
function cleanDirectory(kind, data, creating) {
  const allowed = kind === 'venues'
    ? ['name','capacity','hireable','openingHours','bufferHours','coversAllVenues','active']
    : ['name','colorHex','paletteTone','approvalRequired','active'];
  const result = {};
  for (const key of Object.keys(data || {})) {
    if (!allowed.includes(key)) throw Error('Unsupported directory field.');
    const value = data[key];
    if (key === 'name') { if(typeof value !== 'string' || !value.trim() || value.length > 240)throw Error('Enter a name between 1 and 240 characters.'); result.name=value.trim(); }
    else if (['hireable','coversAllVenues','active','approvalRequired'].includes(key)) { if(typeof value !== 'boolean')throw Error('Invalid option.');result[key]=value; }
    else if (key === 'openingHours') { if(typeof value !== 'string' || value.length > 2000)throw Error('Opening hours are too long.');result[key]=value; }
    else if (key === 'colorHex') { if(!/^#[0-9a-f]{6}$/i.test(value))throw Error('Invalid colour.');result[key]=value; }
    else if (key === 'paletteTone') { if(!Number.isInteger(value) || value < 0 || value > 5)throw Error('Choose a palette shade.');result[key]=value; }
    else { if(key === 'capacity' && value === null){result[key]=null;continue;} if(typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key==='capacity'?100000:168))throw Error('Enter a valid capacity or buffer.');result[key]=value; }
  }
  if (creating && !result.name) throw Error('A name is required.');
  return result;
}
function cleanIslamic(data) {
  if(typeof data?.name !== 'string' || !data.name.trim() || data.name.length > 240)throw Error('Enter an event title between 1 and 240 characters.');
  if(!Number.isInteger(data.month) || data.month<1 || data.month>12 || !Number.isInteger(data.day) || data.day<1 || data.day>30 || !CATEGORIES.includes(data.category))throw Error('Choose a valid Hijri date and category.');
  return {name:data.name.trim(),day:data.day,month:data.month,category:data.category};
}
function register({db,onCall,HttpsError,requireAdmin,FieldValue}) {
  const invalid = error => new HttpsError('invalid-argument',error.message);
  const commit = (tx,actor,entry) => tx.set(db.collection('auditLog').doc(),auditEntry({...entry,userId:actor.uid,userEmail:actor.email}));
  const changeDirectory = onCall(async request => {
    const actor=await requireAdmin(request.auth);const {kind,operation,id,data}=request.data || {};
    if(!['venues','departments'].includes(kind) || !['create','update','delete'].includes(operation) || (operation!=='create' && (typeof id!=='string' || !id || id.includes('/'))))throw new HttpsError('invalid-argument','Invalid directory change.');
    let clean;try { clean=operation==='delete'?null:cleanDirectory(kind,data,operation==='create'); }catch(error){throw invalid(error);}
    const ref=operation==='create'?db.collection(kind).doc():db.collection(kind).doc(id);
    await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(operation!=='create' && !snap.exists)throw new HttpsError('not-found','This item no longer exists.');const before=snap.exists?snap.data():{};
      if(operation==='delete')tx.delete(ref);else if(operation==='create')tx.create(ref,clean);else tx.update(ref,clean);
      commit(tx,actor,{module:'events-bookings',entityType:kind==='venues'?'venue':'bookingType',entityId:ref.id,action:kind+'.'+operation,note:(before.name || clean?.name || ref.id),diff:changedValues(before,operation==='delete'?{}:{...before,...clean})});
    });return {id:ref.id};
  });
  const changeHijriMonth = onCall(async request=>{
    const actor=await requireAdmin(request.auth,'calendar-management');const {hYear,hMonth,gDate,remove=false}=request.data || {};
    if(!Number.isInteger(hYear)||hYear<1300||hYear>1600||!Number.isInteger(hMonth)||hMonth<1||hMonth>12||typeof remove!=='boolean'||(!remove && !validDate(gDate)))throw new HttpsError('invalid-argument','Enter a valid Hijri month, year and Gregorian date.');
    const ref=db.doc('calendarSettings/hijri');let overrides;
    await db.runTransaction(async tx=>{const snap=await tx.get(ref);const before=snap.exists?snap.data().overrides || []:[];
      overrides=before.filter(o=>Number(o.hYear)!==hYear || Number(o.hMonth)!==hMonth);if(!remove)overrides.push({hYear,hMonth,gDate});
      tx.set(ref,{overrides,adjustedBy:actor.email,updatedBy:actor.uid,updatedAt:new Date().toISOString()},{merge:true});
      commit(tx,actor,{module:'calendar-management',entityType:'hijri',entityId:`${hYear}-${hMonth}`,action:remove?'hijri.override_removed':'hijri.override_saved',note:`Hijri month ${hMonth}/${hYear}`,diff:{overrides:{before,after:overrides}}});
    });return {overrides};
  });
  const changeIslamicEvent = onCall(async request=>{
    const actor=await requireAdmin(request.auth,'calendar-management');const {id,revision,data}=request.data || {};let clean;
    try { clean=cleanIslamic(data); }catch(error){throw invalid(error);}
    if(id && (typeof id!=='string' || id.includes('/')))throw new HttpsError('invalid-argument','Invalid event.');
    const ref=id?db.collection('keyIslamicEvents').doc(id):db.collection('keyIslamicEvents').doc();
    await db.runTransaction(async tx=>{const snap=await tx.get(ref);const before=snap.exists?snap.data():{};
      if(id && (!snap.exists || before.revision!==revision))throw new HttpsError('failed-precondition','Another admin changed this event. Cancel and reopen it.');
      const after={...clean,revision:id?revision+1:0,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
      if(id)tx.update(ref,after);else tx.create(ref,{...after,notes:'',enabled:true,priority:50});
      commit(tx,actor,{module:'islamic-events',entityType:'islamicEvent',entityId:ref.id,action:id?'islamic_event.updated':'islamic_event.created',note:clean.name,diff:changedValues(Object.fromEntries(Object.keys(clean).map(k=>[k,before[k]??null])),clean)});
    });return {id:ref.id};
  });
  const recordActivity = onCall(async request=>{
    const actor=await requireAdmin(request.auth,null);const {module,action,entityId=''}=request.data || {};
    const allowed={'module.opened':['events-bookings','calendar-management','tools-automation','website-cms','form-builder','islamic-events','website'], 'session.signout':['tools-automation'], 'calendar.exported':['events-bookings'], 'appearance.changed':['website']};
    if(!allowed[action]?.includes(module) || typeof entityId!=='string' || entityId.length>160)throw new HttpsError('invalid-argument','Unsupported activity.');
    if(action==='module.opened'&&module!=='website')await requireAdmin(request.auth,module==='islamic-events'?'calendar-management':module);
    if(action==='calendar.exported')await requireAdmin(request.auth,'events-bookings');
    await db.collection('auditLog').add(auditEntry({module,action,entityType:'activity',entityId,userId:actor.uid,userEmail:actor.email}));return {ok:true};
  });
  const getAuditEntries = onCall(async request=>{
    await requireAdmin(request.auth,'tools-automation');let filters;try{filters=auditFilters(request.data);}catch(error){throw invalid(error);}
    const cursor=request.data?.cursor;
    if(cursor && (typeof cursor.timestamp!=='string'||Number.isNaN(Date.parse(cursor.timestamp))||typeof cursor.id!=='string'||cursor.id.includes('/')))throw new HttpsError('invalid-argument','Invalid log cursor.');
    let base=db.collection('auditLog').orderBy('timestamp','desc').orderBy(FieldPath.documentId(),'desc');
    if(filters.from)base=base.where('timestamp','>=',filters.from);if(filters.to)base=base.where('timestamp','<',filters.to);
    let next=cursor || null, scanned=0, ended=false;const entries=[];
    // Scan in chronological batches so filters also cover historical logs without a module field.
    while(entries.length<50 && scanned<1000 && !ended){let q=base;if(next)q=q.startAfter(next.timestamp,next.id);const snap=await q.limit(200).get();if(snap.empty){ended=true;break;}
      for(const item of snap.docs){const entry={...item.data(),id:item.id};next={timestamp:entry.timestamp,id:item.id};scanned++;if(matchesAudit(entry,filters))entries.push({...entry,module:require('./auditModel').moduleFor(entry)});if(entries.length===50||scanned===1000)break;}
      if(snap.size<200 && next.id===snap.docs[snap.docs.length-1].id)ended=true;
    }
    return {entries,cursor:ended?null:next,scanned};
  });
  return {changeDirectory,changeHijriMonth,changeIslamicEvent,recordActivity,getAuditEntries};
}
module.exports={register,cleanDirectory,cleanIslamic};
