const {createHash}=require('node:crypto');
const EXCLUDED_METHODS=['acss_debit', 'affirm', 'afterpay_clearpay', 'alipay', 'alma', 'amazon_pay', 'au_becs_debit', 'bacs_debit', 'bancontact', 'billie', 'bizum', 'blik', 'boleto', 'cashapp', 'crypto', 'customer_balance', 'eps', 'fpx', 'giropay', 'grabpay', 'ideal', 'kakao_pay', 'klarna', 'konbini', 'kr_card', 'mb_way', 'mobilepay', 'multibanco', 'naver_pay', 'nz_bank_account', 'oxxo', 'p24', 'pay_by_bank', 'payco', 'paynow', 'paypal', 'paypay', 'payto', 'pix', 'promptpay', 'revolut_pay', 'samsung_pay', 'satispay', 'scalapay', 'sepa_debit', 'sequra', 'sofort', 'sunbit', 'swish', 'twint', 'upi', 'us_bank_account', 'wechat_pay', 'zip'];
const SITE='https://refreshed.muhammadiwelfare.org.au';
const TEST_EMAIL='admin@muhammadiwelfare.org.au';
const FUNDS=['General Donation','313 Contribution','Niaz Contribution','Youth Fund','Khums Contribution'];
const INTERVALS={weekly:{interval:'week',interval_count:1},fortnightly:{interval:'week',interval_count:2},monthly:{interval:'month',interval_count:1},yearly:{interval:'year',interval_count:1}};
const today=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const fault=(message,status=400)=>Object.assign(new Error(message),{status});
function emailAddress(value){const email=typeof value==='string'?value.trim():'';if(email.length>254||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email))throw fault('Enter a valid email address for your confirmation.');return email;}
function cents(value){if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(String(value)))throw fault('Enter a valid donation amount.');const n=Math.round(Number(value)*100);if(n<100||n>10000000)throw fault('Donation must be between $1 and $100,000.');return n;}
function validate(input,now=new Date()){
 if(!input||!FUNDS.includes(input.fund))throw fault('Choose a valid fund.');
 if(typeof input.recurringOptIn!=='boolean')throw fault('Choose whether to add recurring donations.');
 const value={email:emailAddress(input.email),fund:input.fund,amount:cents(input.amount),recurring:null};
 if(input.recurringOptIn){const r=input.recurring;if(!r||!INTERVALS[r.frequency])throw fault('Choose a recurring frequency.');
 const date=r.firstDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date<today(now)||date>today(new Date(now.getTime()+366*86400000)))throw fault('Choose a first date from today through the next year.');
 value.recurring={amount:cents(r.amount),frequency:r.frequency,firstDate:date};}
 return value;
}
function startTimestamp(date){ // 09:00 Sydney, including daylight-saving transitions.
 let ms=Date.parse(date+'T09:00:00Z');
 for(let i=0;i<2;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));const local=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);ms-=local-Date.parse(date+'T09:00:00Z');}
 return Math.floor(ms/1000);
}
const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n/100);
function checkoutParams(d,id){
 const r=d.recurring;
 const consent=r?`Additional recurring donation: ${money(r.amount)} ${r.frequency}, first date ${r.firstDate} (Sydney). You authorise charging this saved card automatically until cancelled. Contact ${TEST_EMAIL} to cancel. ${r.firstDate===today()?'The first recurring charge is also due today.':''}`:'One-off donation only. No recurring authorisation.';
 return {mode:'payment',excluded_payment_method_types:EXCLUDED_METHODS,wallet_options:{link:{display:'never'}},customer_creation:'always',customer_email:d.email,
 line_items:[{price_data:{currency:'aud',unit_amount:d.amount,product_data:{name:'MWA '+d.fund+' — sandbox donation'}},quantity:1}],
 metadata:{mwaDonation:id,integration:'mwa-sandbox-v1'},client_reference_id:id,
 payment_intent_data:{metadata:{mwaDonation:id},...(r?{setup_future_usage:'off_session'}:{})},
 custom_text:{submit:{message:'TEST PAYMENT — no money moves. '+consent}},
 success_url:SITE+'/?donation_result='+id+'#donate',cancel_url:SITE+'/?donation_cancelled=1#donate'};
}
async function rateLimit(db,ip){const bucket=Math.floor(Date.now()/3600000);const id=createHash('sha256').update(ip+':'+bucket).digest('hex');const ref=db.doc('_stripeSandboxLimits/'+id);await db.runTransaction(async tx=>{const s=await tx.get(ref);const count=s.data()?.count||0;if(count>=10)throw fault('Too many checkout attempts. Please try again in an hour.',429);tx.set(ref,{count:count+1,expiresAt:new Date(Date.now()+7200000)});});}
function apiHandler({db,stripe}){return async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const path=req.path.split('/').pop();
  if(req.method==='GET'&&path==='status'){
   const id=String(req.query.id||'');if(!/^[a-f0-9-]{36}$/.test(id))throw fault('Invalid donation reference.');
   const d=(await db.doc('_stripeSandboxDonations/'+id).get()).data();if(!d)throw fault('Donation reference not found.',404);
   return res.json({status:d.status,recurring:d.recurring?d.recurringStatus:null,sandbox:true});
  }
  if(req.method!=='POST'||path!=='checkout')return res.status(405).json({error:'Method not allowed.'});
  if(![SITE,'https://mwa-community-web.web.app','https://mwa-community-web.firebaseapp.com'].includes(req.get('Origin')))throw fault('Open checkout from the MWA website.',403);
  if(!req.is('application/json'))throw fault('Use JSON.',415);
  const d=validate(req.body),id=req.body.requestId;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||''))throw fault('Invalid checkout reference.');
  await rateLimit(db,req.ip||'unknown');
  const ref=db.doc('_stripeSandboxDonations/'+id),hash=createHash('sha256').update(JSON.stringify(d)).digest('hex');
  let existing;
  await db.runTransaction(async tx=>{const s=await tx.get(ref);existing=s.data();if(existing){if(existing.hash!==hash)throw fault('Checkout details changed. Please start again.',409);if(Date.now()-existing.createdAt>23*3600000)throw fault('Checkout expired. Please start again.',409);}else tx.create(ref,{...d,hash,createdAt:Date.now(),status:'awaiting_payment',recurringStatus:d.recurring?'not_started':null,consentVersion:'2026-11-02'});});
  if(existing?.url)return res.json({url:existing.url});
  const session=await stripe.checkout.sessions.create(checkoutParams(d,id),{idempotencyKey:'mwa-checkout-'+id});
  if(session.livemode||!session.url?.startsWith('https://checkout.stripe.com/'))throw Error('Unexpected checkout mode');
  await ref.update({sessionId:session.id,url:session.url});return res.json({url:session.url});
 }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Sandbox checkout is temporarily unavailable. Please retry.'});}
};}
module.exports={emailAddress,SITE,TEST_EMAIL,INTERVALS,today,validate,startTimestamp,checkoutParams,apiHandler,money};
