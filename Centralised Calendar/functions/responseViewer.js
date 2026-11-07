const {OWNER_EMAIL,normalizeEmail}=require('./adminAccess');
function active(g,now=Date.now()){return !!g&&!g.revoked&&Number.isFinite(Date.parse(g.expiresAt))&&Date.parse(g.expiresAt)>now;}
async function resolveViewer(db,uid,token){
 const email=normalizeEmail(token?.email);if(!uid||!email||token.email_verified!==true||email===OWNER_EMAIL)return null;
 const [user,admin]=await Promise.all([db.doc('users/'+uid).get(),db.doc('adminAllowlist/'+email).get()]);
 if(user.data()?.role==='admin'||admin.exists)return null;
 const ref=db.doc('_responseViewers/'+email);
 return db.runTransaction(async tx=>{const snap=await tx.get(ref),g=snap.data();if(!active(g)||(g.uid&&g.uid!==uid))return null;if(!g.uid)tx.update(ref,{uid});return {uid,email,viewer:true,grant:{...g,uid}};});
}
function permitted(grant,formId,form){return active(grant)&&grant.formIds?.includes(formId)&&form?.eventId===grant.eventId;}
function project(grant,formId,response){const allowed=grant.fields?.[formId]||[];const fields=(response.fields||[]).filter(f=>allowed.includes(f.id));return {id:response.id,reference:response.reference,createdAt:response.createdAt,revision:response.revision,formTitle:response.formTitle,fields,answers:Object.fromEntries(fields.map(f=>[f.id,response.answers?.[f.id]??null]))};}
module.exports={active,resolveViewer,permitted,project};
