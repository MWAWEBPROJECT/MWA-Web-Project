const {modules,legacyModules}=require('./adminModules.json');
const {OWNER_EMAIL,normalizeEmail,sessionAllowed}=require('./adminAccess');
const ids=new Set(modules.map(m=>m.id));
function validateModules(value){
 if(!Array.isArray(value)||value.length>modules.length||value.some(id=>typeof id!=='string'||!ids.has(id)))throw new Error('Select valid admin modules.');
 return modules.filter(m=>value.includes(m.id)).map(m=>m.id);
}
function effectiveModules(entry){
 // Fixed migration baseline: adding a future module never grants it to existing admins.
 if(!entry)return [];
 if(!Object.hasOwn(entry,'modules'))return [...legacyModules];
 return Array.isArray(entry.modules)?entry.modules.filter(id=>ids.has(id)):[];
}
function accessActive(entry,now=Date.now()){
 if(entry?.accessExpiresAt==null)return true;
 const v=entry.accessExpiresAt;
 const until=typeof v.toMillis==='function'?v.toMillis():new Date(v).getTime();
 return Number.isFinite(until)&&now<until;
}
function hasModule(email,entry,id){return ids.has(id)&&(normalizeEmail(email)===OWNER_EMAIL||(accessActive(entry)&&effectiveModules(entry).includes(id)));}
async function resolveAdmin(db,uid,token,moduleId=null){
 const email=normalizeEmail(token?.email);
 if(!uid||!email)return null;
 const [user,listed,settings]=await Promise.all([db.doc('users/'+uid).get(),db.doc('adminAllowlist/'+email).get(),db.doc('calendarSettings/auth').get()]);
 const profile=user.exists?user.data():null,entry=listed.exists?listed.data():null;
 if(!profile||profile.role!=='admin'||normalizeEmail(profile.email)!==email||(!listed.exists&&email!==OWNER_EMAIL))return null;
 if(!sessionAllowed({provider:token.firebase?.sign_in_provider||'',passwordLoginDisabled:settings.exists&&settings.data().passwordLoginDisabled===true}))return null;
 const legacyIdentity=token.email_verified!==true&&email!==OWNER_EMAIL&&entry?.uid===uid;
 if(token.email_verified!==true&&!legacyIdentity)return null;
 if(email===OWNER_EMAIL&&token.email_verified!==true)return null;
 if(email!==OWNER_EMAIL&&(entry?.uid!==uid||!accessActive(entry)))return null;
 if(moduleId!==null&&!hasModule(email,entry,moduleId))return null;
 return {uid,email,modules:email===OWNER_EMAIL?modules.map(m=>m.id):effectiveModules(entry)};
}
module.exports={validateModules,effectiveModules,hasModule,resolveAdmin,accessActive};
