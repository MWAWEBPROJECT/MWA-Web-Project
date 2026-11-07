const test=require('node:test'),assert=require('node:assert/strict');
test('owner-only OAuth setup binds state to HttpOnly cookie, verifies mailbox and rejects replay',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
 const C=require('./enquiries-core'),A=require('./enquiries-api'),G=require('./enquiries-gmail');
 const app=initializeApp({projectId:'demo-mwa-enquiries'},'oauth-test'),db=getFirestore(app),original=global.fetch;
 const actor={uid:'oauth-owner',email:C.OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}},origins=new Set([C.SITE]);
 const response=()=>({headers:{},status(code){this.code=code;return this},set(key,value){this.headers[key]=value;return this},json(data){this.body=data;return this},redirect(code,url){this.code=code;this.url=url;return this}});
 try{
  await db.doc('users/'+actor.uid).set({role:'admin',email:actor.email});await db.doc('_enquiryPrivate/mailbox').set({connected:false});
  const auth=()=>({verifyIdToken:async()=>actor});
  const request={path:'/api/enquiries/mailbox',method:'POST',is:()=>true,get:name=>name==='Origin'?C.SITE:name==='Authorization'?'Bearer token':null,body:{action:'configure',credentials:{web:{client_id:'test.apps.googleusercontent.com',client_secret:'test-secret-only-emulator',redirect_uris:[G.CALLBACK]}}}};
  let res=response();await A.handle(request,res,{db,getAuth:auth,origins});assert.equal(res.body.ok,true);
  request.body={action:'connect'};res=response();await A.handle(request,res,{db,getAuth:auth,origins});assert.ok(res.body.url);assert.equal(res.body.cookie,undefined);assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
  const state=new URL(res.body.url).searchParams.get('state'),cookie=res.headers['Set-Cookie'].split(';')[0];
  const callback={query:{state,code:'fake-code'},get:()=>cookie};
  global.fetch=async url=>({ok:true,json:async()=>String(url).includes('oauth2.googleapis.com/token')?{access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,scope:G.SCOPES.join(' ')}:{emailAddress:C.OWNER,historyId:'100'}});
  let done=response();await G.callback(callback,done,db);assert.match(done.url,/mailbox=connected$/);
  const publicStatus=await G.status(db,actor);assert.equal(publicStatus.connected,true);assert.equal(publicStatus.refreshToken,undefined);assert.equal(publicStatus.clientSecret,undefined);
  done=response();await G.callback(callback,done,db);assert.match(done.url,/mailbox=failed$/);
  const other={...actor,uid:'oauth-other',email:'other@example.com'};await db.doc('users/'+other.uid).set({role:'admin',email:other.email});await db.doc('adminAllowlist/'+other.email).set({uid:other.uid});res=response();await A.handle(request,res,{db,getAuth:()=>({verifyIdToken:async()=>other}),origins});assert.equal(res.code,403);
 }finally{global.fetch=original;await deleteApp(app)}
});
