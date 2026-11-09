import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAdminPage,adminBackTarget,isAdminRoute,goAdminBack} from './adminNavigation.mjs';
import {createAdminSessionCheck} from './adminSessionCheck.mjs';

function browser(path='/admin-login') {
  const values=new Map();
  return {location:{pathname:path,search:'',assign(value){this.assigned=value;}},sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
}
test('root returns Home; module/nested routes unwind through the preceding admin page',()=>{
  const win=browser();recordAdminPage(win);assert.equal(adminBackTarget(win),'/');
  win.location.search='?module=form-builder';recordAdminPage(win);
  win.location.pathname='/enquiries/';win.location.search='';recordAdminPage(win);
  assert.equal(adminBackTarget(win),'/admin-login?module=form-builder');
  win.location.pathname='/admin-login';win.location.search='?module=form-builder';recordAdminPage(win);
  assert.equal(adminBackTarget(win),'/admin-login');goAdminBack(win);assert.equal(win.location.assigned,'/admin-login');
});
test('deep links use console fallback; public and unsafe destinations never become admin back targets',()=>{
  const win=browser('/tools-automation/');recordAdminPage(win);assert.equal(adminBackTarget(win),'/admin-login');
  assert.equal(isAdminRoute('/registrations/'),false);
  assert.equal(isAdminRoute('/\\evil.invalid/admin-login'),false);
  win.sessionStorage.setItem('mwa-admin-navigation',JSON.stringify(['//evil.invalid/admin-login','/tools-automation/']));
  assert.equal(adminBackTarget(win),'/admin-login');
});
test('login returnTo does not create a redirecting back target',()=>{
  const win=browser();win.location.search='?returnTo=%2Fcalendar%2F%3Fview%3Dadmin';recordAdminPage(win);
  win.location.pathname='/calendar/';win.location.search='?view=admin';recordAdminPage(win);
  assert.equal(adminBackTarget(win),'/admin-login');
});
test('parent and embedded bootstrap share one check; new identity, reset and failed check require a fresh check',async()=>{
  let user={uid:'a',email:'a@example.invalid',emailVerified:true,providerData:[{providerId:'google.com'}]},calls=0;
  const run=createAdminSessionCheck(()=>user,async()=>{calls++;return {admin:true};});
  await Promise.all([run(user),run({...user})]);assert.equal(calls,1);
  run.reset();await run(user);assert.equal(calls,2);
  const old=user;user={...user,uid:'b'};await assert.rejects(run(old),/changed/);await run(user);assert.equal(calls,3);
  let attempts=0;const retry=createAdminSessionCheck(()=>user,async()=>{if(++attempts===1)throw Error('offline');return {admin:true};});
  await assert.rejects(retry(user),/offline/);await retry(user);assert.equal(attempts,2);
});
