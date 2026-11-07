const {createHash,randomUUID}=require('node:crypto');
const {isOwner,normalizeEmail,sessionAllowed}=require('./adminAccess');

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const stamp=doc=>doc.exists?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'missing';
const categoryRef=(db,id)=>db.doc(`_insightsState/programmeCategories/items/${id}`);
const assignmentRef=(db,id)=>db.doc(`_insightsState/programmeAssignments/events/${id}`);

async function catalog(db){
 const snap=await db.collection('_insightsState/programmeCategories/items').orderBy('__name__').limit(501).get();
 if(snap.size>500)fail(422,'The category catalogue exceeds 500 entries. No partial catalogue was returned.');
 return snap.docs.map(doc=>({id:doc.id,name:doc.data().name}));
}
async function inspect(db,eventId){
 if(!validId(eventId))fail(400,'Choose a valid event reference.');
 const [event,assignment]=await Promise.all([db.doc(`events/${eventId}`).get(),assignmentRef(db,eventId).get()]);
 if(!event.exists)fail(404,'The calendar event is unavailable.');
 const data=event.data(),saved=assignment.data();
 return {event:{id:eventId,title:String(data.title||'Untitled event').slice(0,200),startAt:typeof data.startAt==='string'?data.startAt:'',version:stamp(event)},assignment:saved?{categoryIds:saved.categoryIds,version:saved.version,stale:saved.eventVersion!==stamp(event)}:{categoryIds:[],version:0,stale:false}};
}
async function validateOwner(tx,db,actor){
 const [user,settings]=await Promise.all([tx.get(db.doc(`users/${actor.uid}`)),tx.get(db.doc('calendarSettings/auth'))]);
 if(!isOwner(actor.email)||user.data()?.role!=='admin'||normalizeEmail(user.data()?.email)!==actor.email||!sessionAllowed({provider:actor.provider||'',passwordLoginDisabled:settings.data()?.passwordLoginDisabled===true}))fail(403,'Super Admin access changed. Sign in again.');
}
async function createCategory(db,actor,input){
 const name=typeof input.name==='string'?input.name.trim().replace(/\s+/g,' '):'';
 if(!name||name.length>100)fail(400,'Enter a category name of up to 100 characters.');
 const id=randomUUID(),ref=categoryRef(db,id),timestamp=new Date().toISOString();
 await db.runTransaction(async tx=>{
  await validateOwner(tx,db,actor);
  const existing=await tx.get(db.collection('_insightsState/programmeCategories/items').limit(500));
  if(existing.size>=500)fail(422,'The category catalogue is full (500 entries).');
  if(existing.docs.some(doc=>doc.data().name.toLocaleLowerCase('en-AU')===name.toLocaleLowerCase('en-AU')))fail(409,'A category with this name already exists.');
  tx.create(ref,{name,createdAt:timestamp,createdBy:actor.uid});
  tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'programme-category',entityId:id,action:'insights.programme_category_created',userId:actor.uid,timestamp});
 });
 return {id,name};
}
async function review(db,actor,input){
 const {eventId,eventVersion,version,categoryIds}=input;
 if(!validId(eventId)||typeof eventVersion!=='string'||!Number.isSafeInteger(version)||version<0||!Array.isArray(categoryIds)||categoryIds.length>100||categoryIds.some(id=>!validId(id))||new Set(categoryIds).size!==categoryIds.length)fail(400,'Choose an event and valid distinct categories.');
 const sorted=[...categoryIds].sort(),ref=assignmentRef(db,eventId),timestamp=new Date().toISOString();
 let result;
 await db.runTransaction(async tx=>{
  await validateOwner(tx,db,actor);
  const [event,previous,...categories]=await Promise.all([tx.get(db.doc(`events/${eventId}`)),tx.get(ref),...sorted.map(id=>tx.get(categoryRef(db,id)))]);
  if(!event.exists||stamp(event)!==eventVersion)fail(409,'The calendar event changed. Inspect it again.');
  if((previous.data()?.version||0)!==version)fail(409,'The category review changed. Inspect it again.');
  if(categories.some(doc=>!doc.exists))fail(409,'A category is unavailable. Reload the catalogue.');
  result={eventId,categoryIds:sorted,version:version+1,eventVersion,reviewedAt:timestamp,reviewedBy:actor.uid};
  tx.set(ref,result);
  tx.create(db.collection('auditLog').doc(),{module:'form-insights',entityType:'programme-assignment',entityId:eventId,action:'insights.programme_assignment_reviewed',userId:actor.uid,timestamp,version:result.version});
 });
 return result;
}
function filters(input={}){
 let categories=input.categories===undefined?[]:input.categories;
 if(typeof categories==='string')categories=categories?categories.split(','):[];
 if(!Array.isArray(categories)||categories.length>100||categories.some(id=>id!=='unknown'&&!validId(id))||new Set(categories).size!==categories.length)fail(400,'Choose valid distinct programme categories.');
 const result={categories:[...categories].sort(),bookingType:input.bookingType===undefined?'':input.bookingType,series:input.series===undefined?'':input.series};
 for(const value of [result.bookingType,result.series])if(typeof value!=='string'||(value&&!validId(value)))fail(400,'Choose valid booking type and series references.');
 return result;
}
const active=filter=>filter.categories.length>0||!!filter.bookingType||!!filter.series;
function eventDimensions(event){
 const data=event.data();
 return {categories:[],bookingType:validId(data.departmentId)?data.departmentId:'',series:validId(data.seriesId)?data.seriesId:''};
}
async function dimensions(db,events){
 const refs=events.map(event=>assignmentRef(db,event.id)),assignments=[];
 for(let offset=0;offset<refs.length;offset+=200)assignments.push(...await db.getAll(...refs.slice(offset,offset+200)));
 const ids=[...new Set(assignments.flatMap(doc=>Array.isArray(doc.data()?.categoryIds)&&doc.data().categoryIds.length<=100?doc.data().categoryIds.filter(validId):[]))],categoryDocs=[];
 for(let offset=0;offset<ids.length;offset+=200)categoryDocs.push(...await db.getAll(...ids.slice(offset,offset+200).map(id=>categoryRef(db,id))));
 const available=new Set(categoryDocs.filter(doc=>doc.exists).map(doc=>doc.id));
 const map=new Map();
 for(let i=0;i<events.length;i++){
  const event=events[i],assignment=assignments[i],review=assignment.data();
  const valid=assignment.exists&&review.eventVersion===stamp(event)&&Array.isArray(review.categoryIds)&&review.categoryIds.length<=100&&new Set(review.categoryIds).size===review.categoryIds.length&&review.categoryIds.every(id=>validId(id)&&available.has(id));
  map.set(event.id,{...eventDimensions(event),categories:valid?review.categoryIds:[]});
 }
 const fingerprint=createHash('sha256').update(JSON.stringify([...events,...assignments,...categoryDocs].map(doc=>[doc.ref.path,stamp(doc)]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
 return {map,fingerprint,documents:[...assignments,...categoryDocs]};
}
function matches(value,filter){
 if(filter.categories.length&&!filter.categories.some(id=>id==='unknown'?value.categories.length===0:value.categories.includes(id)))return false;
 return (!filter.bookingType||filter.bookingType===value.bookingType)&&(!filter.series||filter.series===value.series);
}
module.exports={catalog,inspect,createCategory,review,filters,active,eventDimensions,dimensions,matches};
