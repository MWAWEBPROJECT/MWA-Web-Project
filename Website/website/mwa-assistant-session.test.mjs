import test from 'node:test';import assert from 'node:assert/strict';import {watchAssistantIdentity} from './mwa-assistant-session.mjs';
test('guest startup notifications preserve chat; actual identity or grants changes clear it',()=>{
 let state={uid:null,isAdmin:false,modules:[],loading:true},cleared=0;
 const changed=watchAssistantIdentity(()=>state,()=>cleared++);
 changed();state={...state,loading:false};changed();assert.equal(cleared,0);
 state={uid:'admin-a',isAdmin:true,modules:['niaz','donations']};changed();assert.equal(cleared,1);
 state={...state,modules:['donations','niaz']};changed();assert.equal(cleared,1);
 state={...state,modules:['niaz']};changed();assert.equal(cleared,2);
 state={...state,uid:'admin-b'};changed();assert.equal(cleared,3);
 state={uid:null,isAdmin:false,modules:[]};changed();assert.equal(cleared,4);
});
