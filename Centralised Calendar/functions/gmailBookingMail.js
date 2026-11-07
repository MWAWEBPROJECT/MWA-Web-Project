// Reuse the existing admin mailbox OAuth connection; never copy credentials.
const {getFirestore}=require('firebase-admin/firestore');
const nodemailer=require('nodemailer');
const ADMIN='admin@muhammadiwelfare.org.au';
async function sendBookingGmail(message,{db=getFirestore(),fetcher=fetch,now=Date.now(),notAfter}={}){
 const remaining=()=>notAfter===undefined?25000:Math.min(25000,notAfter-Date.now());
 const ref=db.doc('_enquiryPrivate/mailbox'),config=(await ref.get()).data();
 if(!config?.connected)return {sent:false,reason:'not-configured'};
 if(String(config.mailbox||'').toLowerCase()!==ADMIN||!config.refreshToken)return {sent:false,reason:'invalid-configuration'};
 if(remaining()<=0)return {sent:false,reason:'send-window-expired'};
 let token=config.accessToken;
 if(!token||config.expiresAt<=now+60000){
  if(remaining()<=0)return {sent:false,reason:'send-window-expired'};
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'}).toString(),signal:AbortSignal.timeout(Math.max(1,remaining()))});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)return {sent:false,reason:'mailbox-auth-failed'};
  token=data.access_token;
  await ref.update({accessToken:token,expiresAt:now+(data.expires_in||3600)*1000,lastError:null});
 }
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
 const compiled=await transport.sendMail({...message,from:ADMIN});
 // Never fall back to SMTP after a Gmail send attempt: delivery may be ambiguous.
 if(remaining()<=0)return {sent:false,reason:'send-window-expired'};
 const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw:compiled.message.toString('base64url')}),signal:AbortSignal.timeout(Math.max(1,remaining()))});
 return response.ok?{sent:true}:{sent:false,reason:response.status===401||response.status===403?'mailbox-auth-failed':'send-error'};
}
module.exports={sendBookingGmail};
