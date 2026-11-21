const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('./gallery-api');
const id='a'.repeat(64);
const docs=[{id,data:()=>({state:'ready',visibility:'hidden',title:'Secret event',caption:'Private',event:'Hidden gathering',category:'Event',tags:'secret',date:null,width:100,height:80,revision:1})},{id:'b'.repeat(64),data:()=>({state:'ready',visibility:'public',title:'Community',caption:'Public',event:'Open day',category:'Event',tags:'open',date:null,width:100,height:80,revision:1})}];
const db={doc:()=>({get:async()=>({data:()=>docs[0].data()})}),collection:()=>({orderBy(){return this},limit(){return this},get:async()=>({docs})})};
function response(){return {statusCode:200,headers:{},status(n){this.statusCode=n;return this},set(k,v){this.headers[k]=v;return this},json(x){this.body=x;return this},send(x){this.body=x;return this}}}
test('anonymous gallery list projects only public photos',async()=>{const res=response();await api.handle({path:'/api/gallery',method:'GET',query:{},get:()=>null},res,{db,editorFor:async()=>null,origins:new Set()});assert.equal(res.body.items.length,1);assert.equal(res.body.items[0].title,'Community');assert.equal(JSON.stringify(res.body).includes('Secret event'),false)});
test('hidden previews and originals require gallery access',async()=>{for(const variant of ['preview','original']){const res=response();await assert.rejects(api.handle({path:'/api/gallery/image/'+id+'/'+variant,method:'GET',query:{},get:()=>null},res,{db,editorFor:async()=>null,origins:new Set(),storeFactory:()=>({get:()=>{throw Error('Must not read storage')}})}),e=>e.status===404)}});
test('metadata permits category-only photographs and rejects invalid dates',()=>{const record={title:'Photo',caption:'',event:'',category:'Event',tags:'',date:null,visibility:'hidden'};assert.equal(api.metadata(record).caption,'');assert.equal(api.metadata({...record,title:''}).title,'');assert.throws(()=>api.metadata({...record,category:''}));assert.throws(()=>api.metadata({...record,date:'2026-02-30'}));assert.throws(()=>api.metadata({...record,visibility:'other'}));});
test('featured selection requires ordered unique photo IDs and a revision',()=>{
 const photo='b'.repeat(64),valid={revision:0,heroIds:[photo],categoryIds:{Event:[photo]}};
 assert.deepEqual(api.featuredInput(valid),valid);
 assert.throws(()=>api.featuredInput({...valid,heroIds:[photo,photo]}),e=>e.status===400);
 assert.throws(()=>api.featuredInput({...valid,revision:undefined}),e=>e.status===400);
 assert.throws(()=>api.featuredInput({...valid,categoryIds:{Event:['not-an-id']}}),e=>e.status===400);
});
test('public featured choices omit photographs hidden after curation',async()=>{
 const hidden='a'.repeat(64),publicId='b'.repeat(64),settings={heroIds:[hidden,publicId],categoryIds:{Event:[hidden,publicId]},revision:4};
 const fake={doc:path=>({get:async()=>({data:()=>path==='gallerySettings/main'?settings:{state:'ready',visibility:path.endsWith(hidden)?'hidden':'public',category:'Event'}})})};
 const res=response();await api.handle({path:'/api/gallery/featured',method:'GET',query:{},get:()=>null},res,{db:fake,editorFor:async()=>null,origins:new Set()});
 assert.deepEqual(res.body,{heroIds:[publicId],categoryIds:{Event:[publicId]}});
});
test('featured photo edits require gallery permission and public images in matching categories',async()=>{
 const photo='b'.repeat(64),body={revision:0,heroIds:[photo],categoryIds:{Event:[photo]}},base={path:'/api/gallery/admin/featured',method:'PUT',body,get:()=> 'https://refreshed.muhammadiwelfare.org.au',is:()=>true};
 const contexts={db:{doc:()=>({get:async()=>({data:()=>({state:'ready',visibility:'hidden',category:'Event'})})})},editorFor:async()=>null,origins:new Set(['https://refreshed.muhammadiwelfare.org.au'])};
 await assert.rejects(api.handle(base,response(),contexts),e=>e.status===403);
 await assert.rejects(api.handle(base,response(),{...contexts,editorFor:async()=>({uid:'admin',email:'admin@example.org'})}),e=>e.status===400);
 await assert.rejects(api.handle({...base,body:{...body,categoryIds:{Other:[photo]}}},response(),{...contexts,db:{doc:()=>({get:async()=>({data:()=>({state:'ready',visibility:'public',category:'Event'})})})},editorFor:async()=>({uid:'admin',email:'admin@example.org'})}),e=>e.status===400);
});
test('approved upload stores an original, watermarked variants and ready metadata',async()=>{
 const sharp=require('sharp'),image=await sharp({create:{width:60,height:40,channels:3,background:'#123456'}}).png().toBuffer(),writes=[],puts=[];
 const fake={doc:()=>({get:async()=>({exists:false,data:()=>null})}),collection:()=>({doc:()=>({})}),runTransaction:async fn=>fn({get:async()=>({exists:false,data:()=>null}),set:(ref,record)=>writes.push(record)})};
 const req={path:'/api/gallery/admin/upload',method:'POST',query:{},get:()=> 'https://refreshed.muhammadiwelfare.org.au',is:()=>true,body:{title:'Community art',caption:'',event:'',category:'Art Event',tags:'art',date:null,visibility:'hidden',image:{type:'image/png',data:image.toString('base64')}}};
 const res=response();await api.handle(req,res,{db:fake,editorFor:async()=>({uid:'admin-1',email:'admin@example.org'}),origins:new Set(['https://refreshed.muhammadiwelfare.org.au']),storeFactory:()=>({put:async(...args)=>puts.push(args)})});
 assert.equal(res.statusCode,201);assert.equal(puts.length,3);assert.deepEqual(puts.map(p=>p[1]),['original','preview','thumb']);assert.ok(writes.some(w=>w.state==='ready'&&w.visibility==='hidden'));assert.ok(!JSON.stringify(res.body).includes('data'));
});
