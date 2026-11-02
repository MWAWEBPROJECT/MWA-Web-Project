const Stripe=require('stripe');
const {onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {defineSecret}=require('firebase-functions/params');
const {getFirestore}=require('firebase-admin/firestore');
const key=defineSecret('STRIPE_SANDBOX_SECRET_KEY');
function client(){const value=key.value();if(!/^(rk|sk)_test_/.test(value))throw Error('Sandbox key required');return new Stripe(value,{apiVersion:'2026-10-28.endive',maxNetworkRetries:2});}
exports.donationSandboxApi=onRequest({region:'australia-southeast1',maxInstances:2,secrets:[key]},(req,res)=>require('./donations').apiHandler({db:getFirestore(),stripe:client()})(req,res));
exports.donationSandboxWorker=onSchedule({region:'australia-southeast1',schedule:'every 2 minutes',timeoutSeconds:240,maxInstances:1,secrets:[key]},()=>require('./donations-worker').run(getFirestore(),client()));
