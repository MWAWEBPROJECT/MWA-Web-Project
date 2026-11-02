const {onRequest}=require('firebase-functions/v2/https');

// Bootstrap endpoint for registering the sandbox destination in Stripe.
// Do not acknowledge events until signature verification and payment fulfilment
// are implemented together. Stripe retries non-2xx responses.
exports.stripeSandboxWebhook=onRequest({region:'australia-southeast1',maxInstances:2},(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).set('Allow','POST').json({error:'Method not allowed.'});
  return res.status(503).json({error:'Sandbox payment integration is not enabled yet.'});
});
