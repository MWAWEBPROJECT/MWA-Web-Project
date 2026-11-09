import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServer as createHttpServer} from 'node:http';
import {test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
async function fixture({siteKey='synthetic-key',existing=false,failInit=false}={},check){
 const calls=[],app={name:'mwa-booking-phone-verification'},state={calls,app,existing,failInit};
 globalThis.__phoneAuthTest=state;
 const mocks={name:'phone-auth-lazy-test',enforce:'pre',resolveId(source){
  if(['phone-test/app','phone-test/app-check','phone-test/auth'].includes(source))return '\0phone-'+source;
  if(source==='../firebase/firebaseConfig.js')return '\0phone-config';
  if(source==='../firebase/firebase.js')return '\0phone-main-firebase';
  if(source==='../services/eventsService.js')return '\0phone-events';
  if(source==='./ProgramExtras.jsx')return '\0phone-extras';
 },load(id){
  const state='const state=globalThis.__phoneAuthTest;';
  if(id==='\0phone-phone-test/app')return state+`export const getApps=()=>state.existing?[state.app]:[],initializeApp=()=>{state.calls.push('initializeApp');return state.app;};`;
  if(id==='\0phone-phone-test/app-check')return state+`export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key;}}export const initializeAppCheck=(app,options)=>{state.calls.push('initializeAppCheck');state.options=options;state.checkedApp=app;if(state.failInit)throw Error('Synthetic App Check failure');};`;
  if(id==='\0phone-phone-test/auth')return state+`export const getAuth=app=>{state.calls.push('getAuth');return {app};},inMemoryPersistence='memory',setPersistence=async()=>{state.calls.push('setPersistence');},signInWithPhoneNumber=async()=>{state.calls.push('signInWithPhoneNumber');return {confirm:async()=>({user:{getIdToken:async()=> 'synthetic-token'}})};},signOut=async()=>{state.calls.push('signOut');},onAuthStateChanged=()=>()=>{};export class RecaptchaVerifier{constructor(){state.calls.push('RecaptchaVerifier');}clear(){state.calls.push('clear');}}`;
  if(id==='\0phone-config')return 'export const firebaseConfig={};';
  if(id==='\0phone-main-firebase')return 'export const auth={currentUser:null};';
  if(id==='\0phone-events')return 'export const '+['submitBooking','decideBooking','updateBookingScoped','createRecurringBooking','deleteBooking','checkSlotConflicts','previewRecurringBooking','startBookingVerification','verifyBookingEmailCode','verifyBookingMobile'].map(name=>name+'=async()=>({})').join(',')+';';
  if(id==='\0phone-extras')return 'export const ProgramExtrasSummary=()=>null,ProgramExtrasEditor=()=>null;';
 },transform(source,id){
  if(id.endsWith('/services/phoneBookingAuth.js'))return source.replaceAll("'firebase/","'phone-test/").replaceAll('import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY',JSON.stringify(siteKey));
  if(id.endsWith('/components/BookingModal.jsx'))return source.replaceAll("'firebase/","'phone-test/");
 }};
 const hmrServer=createHttpServer();
 const server=await createServer({configFile:false,root,plugins:[mocks,react()],server:{middlewareMode:true,hmr:{server:hmrServer}},appType:'custom'});
 try{
  const service=await server.ssrLoadModule('/src/services/phoneBookingAuth.js');
  await check({service,server,state});
 }finally{await server.close();delete globalThis.__phoneAuthTest;}
}
test('phone service and BookingModal imports do not initialise phone App Check; first send initialises once before Auth requests',async()=>{
 await fixture({},async({service,server,state})=>{
  assert.equal(state.calls.filter(value=>value==='initializeAppCheck').length,0);
  await server.ssrLoadModule('/src/components/BookingModal.jsx');
  assert.equal(state.calls.filter(value=>value==='initializeAppCheck').length,0);
  assert.deepEqual(Object.keys(service).sort(),['clearBookingPhoneRecaptcha','confirmBookingPhoneCode','normalizeBookingPhone','sendBookingPhoneCode'].sort());
  assert.equal(service.normalizeBookingPhone('0412 345 678'),'+61412345678');
  const confirmations=await Promise.all([service.sendBookingPhoneCode('0412 345 678'),service.sendBookingPhoneCode('+61412345679')]);
  assert.equal(state.calls.filter(value=>value==='initializeAppCheck').length,1);
  assert.equal(state.calls.filter(value=>value==='setPersistence').length,1);
  assert.ok(state.calls.indexOf('getAuth')<state.calls.indexOf('initializeAppCheck'));
  assert.ok(state.calls.indexOf('initializeAppCheck')<state.calls.indexOf('setPersistence'));
  assert.ok(state.calls.indexOf('initializeAppCheck')<state.calls.indexOf('RecaptchaVerifier'));
  assert.ok(state.calls.indexOf('initializeAppCheck')<state.calls.indexOf('signInWithPhoneNumber'));
  assert.equal(state.checkedApp,state.app);
  assert.equal(state.options.provider.key,'synthetic-key');
  assert.equal(state.options.isTokenAutoRefreshEnabled,true);
  assert.equal(await service.confirmBookingPhoneCode(confirmations[0],'123456'),'synthetic-token');
 });
});
test('missing phone App Check key preserves existing Auth flow without initialisation',async()=>{
 await fixture({siteKey:''},async({service,state})=>{
  await service.sendBookingPhoneCode('0412345678');await service.sendBookingPhoneCode('0412345679');
  assert.equal(state.calls.includes('initializeAppCheck'),false);
  assert.equal(state.calls.filter(value=>value==='signInWithPhoneNumber').length,2);
 });
});
test('existing phone app guard skips duplicate App Check initialisation',async()=>{
 await fixture({existing:true},async({service,state})=>{
  await service.sendBookingPhoneCode('0412345678');
  assert.equal(state.calls.includes('initializeApp'),false);assert.equal(state.calls.includes('initializeAppCheck'),false);
  assert.equal(state.calls.includes('signInWithPhoneNumber'),true);
 });
});
test('failed phone App Check initialisation surfaces the error, blocks Auth requests and can be retried',async()=>{
 await fixture({failInit:true},async({service,state})=>{
  await assert.rejects(service.sendBookingPhoneCode('0412345678'),/Synthetic App Check failure/);
  assert.equal(state.calls.includes('signInWithPhoneNumber'),false);
  assert.equal(state.calls.includes('setPersistence'),false);
  state.failInit=false;await service.sendBookingPhoneCode('0412345678');
  assert.equal(state.calls.filter(value=>value==='initializeAppCheck').length,2);
  assert.equal(state.calls.filter(value=>value==='signInWithPhoneNumber').length,1);
 });
});
test('pinned Firebase Auth resolves a late App Check provider on each request; failed optional lookup is not cached',async()=>{
 const require=createRequire(import.meta.url),App=require('firebase/app'),Auth=require('firebase/auth'),{Component,ComponentContainer}=require('@firebase/component');
 const app=App.initializeApp({apiKey:'synthetic-local-key',appId:'synthetic-local-app'},'phone-lazy-sdk-test');
 try{
  const auth=Auth.initializeAuth(app,{persistence:Auth.inMemoryPersistence});
  assert.equal((await auth._getAdditionalHeaders())['X-Firebase-AppCheck'],undefined);
  const provider=App._getProvider(app,'app-check-internal');let requests=0;
  provider.setComponent(new Component('app-check-internal',()=>({getToken:async()=>({token:'synthetic-token-'+(++requests)})}),'PRIVATE'));
  assert.equal((await auth._getAdditionalHeaders())['X-Firebase-AppCheck'],'synthetic-token-1');
  assert.equal((await auth._getAdditionalHeaders())['X-Firebase-AppCheck'],'synthetic-token-2');
  const container=new ComponentContainer('failed-optional-provider'),optional=container.getProvider('test');let ready=false;
  optional.setComponent(new Component('test',()=>{if(!ready)throw Error('Not ready');return {ready:true};},'PRIVATE'));
  assert.equal(optional.getImmediate({optional:true}),null);
  ready=true;assert.deepEqual(optional.getImmediate({optional:true}),{ready:true});
 }finally{await App.deleteApp(app);}
});
