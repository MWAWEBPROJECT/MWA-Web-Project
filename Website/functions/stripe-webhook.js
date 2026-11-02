const Stripe=require('stripe');
const eventTypes=new Set([
 'checkout.session.completed','checkout.session.async_payment_succeeded',
 'checkout.session.async_payment_failed','checkout.session.expired',
 'invoice.paid','invoice.payment_failed','invoice.payment_action_required',
 'customer.subscription.updated','customer.subscription.deleted',
 'subscription_schedule.created','subscription_schedule.updated',
 'subscription_schedule.canceled','subscription_schedule.aborted',
 'subscription_schedule.released','subscription_schedule.completed'
]);

// Receipt is not fulfilment: a separate worker must process pending records
// before donation checkout can be enabled. Never log request bodies or secrets.
function webhookHandler({secret,store,verify=(...args)=>Stripe.webhooks.constructEvent(...args)}){
 return async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).set('Allow','POST').json({error:'Method not allowed.'});
  let signingSecret;
  try{signingSecret=secret();}catch{return res.status(503).json({error:'Webhook configuration unavailable.'});}
  if(!signingSecret?.startsWith('whsec_'))return res.status(503).json({error:'Webhook configuration unavailable.'});
  if(!Buffer.isBuffer(req.rawBody)||req.rawBody.length>800000)return res.status(400).json({error:'Invalid webhook body.'});
  let event;
  try{event=verify(req.rawBody,req.get('stripe-signature'),signingSecret);}catch{return res.status(400).json({error:'Invalid webhook signature.'});}
  if(event.livemode!==false)return res.status(400).json({error:'Sandbox events only.'});
  if(event.object!=='event'||!/^evt_[A-Za-z0-9_]+$/.test(event.id||'')||!event.data?.object?.id)return res.status(400).json({error:'Invalid snapshot event.'});
  if(!eventTypes.has(event.type))return res.status(200).json({received:true,ignored:true});
  try{await store(event);return res.status(200).json({received:true});}
  catch{return res.status(503).json({error:'Webhook storage unavailable. Retry delivery.'});}
 };
}
async function storeEvent(db,event){
 try{
  // Store JSON as a single string, avoiding nested field/index explosion.
  // Collection is server-only under the existing default-deny rules.
  await db.collection('_stripeSandboxEvents').doc(event.id).create({
   eventId:event.id,type:event.type,objectId:event.data.object.id,
   apiVersion:event.api_version||null,created:event.created,
   receivedAt:new Date().toISOString(),status:'pending',payload:JSON.stringify(event)
  });
 }catch(error){if(error.code!==6&&error.code!=='already-exists')throw error;}
}
module.exports={webhookHandler,storeEvent,eventTypes};
