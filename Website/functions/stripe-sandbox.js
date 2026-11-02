const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {getFirestore}=require('firebase-admin/firestore');
const {webhookHandler,storeEvent}=require('./stripe-webhook');
const webhookSecret=defineSecret('STRIPE_SANDBOX_WEBHOOK_SECRET');
exports.stripeSandboxWebhook=onRequest({
 region:'australia-southeast1',maxInstances:2,secrets:[webhookSecret]
},webhookHandler({secret:()=>webhookSecret.value(),store:event=>storeEvent(getFirestore(),event)}));
