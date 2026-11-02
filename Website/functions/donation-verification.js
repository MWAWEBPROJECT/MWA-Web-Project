const idOf=v=>typeof v==='string'?v:v?.id;
function verifySession(s,d,id){
 if(s.livemode!==false||s.metadata?.mwaDonation!==id||s.metadata?.integration!=='mwa-sandbox-v1')throw Error('Session mismatch');
 if(d.donationMode==='recurring_only'){
  if(s.mode!=='setup'||s.currency!=='aud'||![null,0,undefined].includes(s.amount_total))throw Error('Setup mode mismatch');
  if(s.status!=='complete')return {ready:false};
  const intent=s.setup_intent;
  if(!intent||typeof intent==='string'||intent.livemode!==false||intent.metadata?.mwaDonation!==id||intent.metadata?.integration!=='mwa-sandbox-v1'||idOf(intent.customer)!==idOf(s.customer)||!idOf(s.customer))throw Error('Setup intent mismatch');
  return {ready:intent.status==='succeeded'&&intent.usage==='off_session'&&!!idOf(intent.payment_method),method:idOf(intent.payment_method)};
 }
 if(s.mode&&s.mode!=='payment'||s.amount_total!==d.amount||s.currency!=='aud')throw Error('Payment mismatch');
 return {ready:s.payment_status==='paid',method:idOf(s.payment_intent?.payment_method)};
}
module.exports={verifySession};
