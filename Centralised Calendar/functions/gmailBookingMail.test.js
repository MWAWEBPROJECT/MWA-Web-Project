const test=require('node:test'),assert=require('node:assert/strict');
const {sendBookingGmail}=require('./gmailBookingMail');
function database(config){return {doc:()=>({get:async()=>({data:()=>config}),update:async patch=>Object.assign(config,patch)})};}
test('booking Gmail fails closed for disconnected or wrong mailbox without network',async()=>{
 for(const config of [{connected:false},{connected:true,mailbox:'wrong@example.org',refreshToken:'fixture'}]){
 const result=await sendBookingGmail({to:'fixture@example.invalid'},{db:database(config),fetcher:()=>{throw Error('must not call');}});assert.equal(result.sent,false);
 }
});
test('booking Gmail preserves sender, reply-to, HTML and calendar attachment using existing OAuth',async()=>{
 const config={connected:true,mailbox:'admin@muhammadiwelfare.org.au',refreshToken:'fixture',accessToken:'synthetic',expiresAt:Date.now()+3600000};let calls=0;
 const result=await sendBookingGmail({to:'fixture@example.invalid',replyTo:'Events@muhammadiwelfare.org.au',subject:'Booking Confirmed',text:'Fixture',html:'<p>Fixture</p>',attachments:[{filename:'event.ics',content:'BEGIN:VCALENDAR\r\nEND:VCALENDAR',contentType:'text/calendar'}]},{db:database(config),fetcher:async(url,options)=>{
 calls++;assert.match(url,/messages\/send$/);const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();assert.match(raw,/From: admin@muhammadiwelfare.org.au/);assert.match(raw,/Reply-To: Events@muhammadiwelfare.org.au/);assert.match(raw,/event.ics/);assert.match(raw,/text\/html/);return {ok:true};}});
 assert.equal(result.sent,true);assert.equal(calls,1);
});
test('booking Gmail refresh failure never sends or falls back to SMTP',async()=>{
 let calls=0;const result=await sendBookingGmail({to:'fixture@example.invalid'},{db:database({connected:true,mailbox:'admin@muhammadiwelfare.org.au',refreshToken:'fixture'}),fetcher:async()=>{calls++;return {ok:false,json:async()=>({error:'invalid_grant'})};}});assert.equal(result.reason,'mailbox-auth-failed');assert.equal(calls,1);
});
test('expired send windows stop before OAuth or Gmail sends',async()=>{
 const config={connected:true,mailbox:'admin@muhammadiwelfare.org.au',refreshToken:'fixture'};let calls=0;
 let result=await sendBookingGmail({to:'fixture@example.invalid'},{db:database(config),notAfter:Date.now()-1,fetcher:async()=>{calls++;throw Error('must not call');}});
 assert.equal(result.reason,'send-window-expired');assert.equal(calls,0);
 result=await sendBookingGmail({to:'fixture@example.invalid'},{db:database(config),notAfter:Date.now()+20,fetcher:async url=>{
  calls++;assert.match(url,/oauth2\.googleapis\.com/);await new Promise(resolve=>setTimeout(resolve,35));return {ok:true,json:async()=>({access_token:'synthetic',expires_in:3600})};
 }});
 assert.equal(result.reason,'send-window-expired');assert.equal(calls,1);
});
