const test=require('node:test');
const assert=require('node:assert/strict');
const Stripe=require('stripe');
const {webhookHandler,storeEvent}=require('./stripe-webhook');
const secret='whsec_unit_test_only';
const base={id:'evt_test',object:'event',type:'checkout.session.completed',livemode:false,created:1,data:{object:{id:'cs_test'}}};
async function request({event=base,method='POST',key=secret,signature,body,store=async()=>{},configured=secret,timestamp}={}){
 const rawBody=body||Buffer.from(JSON.stringify(event));
 const sig=signature??Stripe.webhooks.generateTestHeaderString({payload:rawBody.toString(),secret:key,timestamp});
 const req={method,rawBody,get:()=>sig};
 const res={code:200,set(){return this},status(code){this.code=code;return this},json(value){this.value=value;return this}};
 await webhookHandler({secret:()=>configured,store})(req,res);return res;
}
test('valid signed event stored before acknowledgement',async()=>{let stored;const r=await request({store:async e=>{stored=e}});assert.equal(r.code,200);assert.equal(stored.id,base.id)});
test('wrong signing secret rejected without storage',async()=>{const r=await request({key:'whsec_wrong',store:()=>assert.fail()});assert.equal(r.code,400)});
test('missing signature rejected',async()=>assert.equal((await request({signature:''})).code,400));
test('expired signature rejected',async()=>assert.equal((await request({timestamp:1})).code,400));
test('live event rejected',async()=>assert.equal((await request({event:{...base,livemode:true}})).code,400));
test('non POST rejected',async()=>assert.equal((await request({method:'GET'})).code,405));
test('missing configuration fails closed',async()=>assert.equal((await request({configured:''})).code,503));
test('storage failure requests Stripe retry',async()=>assert.equal((await request({store:async()=>{throw Error('offline')}})).code,503));
test('unsupported events ignored without writing',async()=>{const r=await request({event:{...base,type:'customer.created'},store:()=>assert.fail()});assert.equal(r.code,200);assert.equal(r.value.ignored,true)});
test('malformed snapshot rejected',async()=>assert.equal((await request({event:{...base,data:{}}})).code,400));
test('atomic create deduplicates without resetting record',async()=>{
 const records=new Map();const db={collection:name=>{assert.equal(name,'_stripeSandboxEvents');return {doc:id=>({create:async record=>{if(records.has(id))throw {code:6};records.set(id,record)}})}}};
 await storeEvent(db,base);records.get(base.id).status='processed';await storeEvent(db,base);
 assert.equal(records.size,1);assert.equal(records.get(base.id).status,'processed');
});
test('database errors propagate',async()=>{const db={collection:()=>({doc:()=>({create:async()=>{throw {code:14}}})})};await assert.rejects(()=>storeEvent(db,base))});
