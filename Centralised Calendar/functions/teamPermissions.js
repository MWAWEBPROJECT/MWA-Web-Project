const {localToUtcIso}=require('./dateUtils');
const {OWNER_EMAIL,normalizeEmail,isValidEmail}=require('./adminAccess');
const {validateModules,effectiveModules}=require('./moduleAccess');
function validateExpiry(value,now=Date.now()){
 if(value===null)return {accessExpiryDate:null,accessExpiresAt:null};
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Choose an expiry date or Indefinite.');
 const date=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||date.getUTCFullYear()>2100)throw new Error('Choose a valid expiry date.');
 date.setUTCDate(date.getUTCDate()+1);
 const until=new Date(localToUtcIso(date.toISOString().slice(0,10),'00:00'));
 if(until.getTime()<=now)throw new Error('Choose today or a future expiry date.');
 return {accessExpiryDate:value,accessExpiresAt:until};
}
function register({db,onCall,HttpsError,requireAdmin}){
 const change=operation=>onCall({cors:true},async request=>{
  const actor=await requireAdmin(request.auth,'tools-automation');
  if(actor.email!==OWNER_EMAIL)throw new HttpsError('permission-denied','Only the Super Admin can manage admin permissions.');
  const email=normalizeEmail(request.data?.email);
  if(!isValidEmail(email))throw new HttpsError('invalid-argument','Enter a valid email address.');
  if(email===OWNER_EMAIL)throw new HttpsError('failed-precondition','Super Admin always has full access.');
  let modules,expiry;try{modules=validateModules(request.data?.modules);expiry=validateExpiry(request.data?.expiryDate)}catch(e){throw new HttpsError('invalid-argument',e.message)}
  const ref=db.doc('adminAllowlist/'+email),timestamp=new Date().toISOString();
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   const viewerRef=db.doc('_responseViewers/'+email),viewer=await tx.get(viewerRef);
   if(operation==='add'&&snap.exists)throw new HttpsError('already-exists','That email is already on the admin list.');
   if(operation==='update'&&!snap.exists)throw new HttpsError('not-found','This admin is no longer on the team.');
   const before=snap.exists?snap.data():null;
   if(operation==='update'&&request.data.revision!==(before.permissionsRevision||0))throw new HttpsError('failed-precondition','Permissions changed since you opened this editor. Cancel and reopen it.');
   const permissionsRevision=(before?.permissionsRevision||0)+1;
   const data={modules,...expiry,permissionsRevision,permissionsUpdatedAt:timestamp,permissionsUpdatedBy:actor.email};
   if(viewer.exists&&!viewer.data().revoked)tx.update(viewerRef,{revoked:true,revision:(viewer.data().revision||0)+1,retiredAt:timestamp,retiredReason:'admin-assignment'});
   if(operation==='add')tx.create(ref,{...data,email,addedBy:actor.email,addedAt:timestamp});else tx.update(ref,data);
   tx.set(db.collection('auditLog').doc(),{module:'tools-automation',entityType:'admin',entityId:email,action:operation==='add'?'admin.added':'admin.permissions_changed',userId:actor.uid,userEmail:actor.email,timestamp,note:'Module access for '+email,diff:{modules:{before:effectiveModules(before),after:modules},expiryDate:{before:before?.accessExpiryDate||null,after:expiry.accessExpiryDate}}});
  });return {ok:true,email,modules};
 });
 return {addAdminEmail:change('add'),setAdminModules:change('update')};
}
module.exports={register,validateExpiry};
