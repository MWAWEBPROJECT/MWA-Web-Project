import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=await build({stdin:{contents:`export {default as FormBuilder} from './website/FormBuilder.jsx';export {default as AdminConsole} from './website/AdminConsole.jsx';export {default as RegistrationFields} from './website/RegistrationFields.jsx';export {default as RegistrationShare} from './website/RegistrationShare.jsx';export {default as Registrations} from './website/Registrations.jsx';`,resolveDir:root,loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',plugins:[{name:'form-fixtures',setup(builder){
 builder.onResolve({filter:/^@calendar\/contexts\/AuthContext\.jsx$/},()=>({path:'auth',namespace:'fixture'}));
 builder.onResolve({filter:/^@calendar\/firebase\/firebase\.js$/},()=>({path:'firebase',namespace:'fixture'}));
 builder.onResolve({filter:/^@mwa\/access$/},()=>({path:path.resolve(root,'shared/module-access.js')}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:p==='auth'?'export const useAuth=()=>globalThis.__formSession;':'export const auth={currentUser:null};',loader:'js'}));
 builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
}}]});
const module={exports:{}};
new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {FormBuilder,AdminConsole,RegistrationFields,RegistrationShare,Registrations}=module.exports;
test('Form Builder is an independent module with a dedicated link and access guard',()=>{
 for(const modules of [[],['website-cms'],['form-builder']]){
  globalThis.__formSession={isAdmin:true,canAccess:id=>modules.includes(id),user:{uid:'fixture'}};
  const builder=renderToStaticMarkup(React.createElement(FormBuilder));
  assert.equal(builder.includes('Create form'),modules.includes('form-builder'));
  assert.equal(builder.includes('does not have access'),!modules.includes('form-builder'));
  const consoleHtml=renderToStaticMarkup(React.createElement(AdminConsole,{email:'fixture@example.com'}));
  assert.equal(consoleHtml.includes('href="/admin-login?module=form-builder"'),modules.includes('form-builder'));
 }
 delete globalThis.__formSession;
});
test('Community Connect choice and consent render safely with accessible labels',()=>{
 const fields=[
  {id:'choice',type:'radio',label:'Choose <script>',options:['One','Two'],description:'One option',required:true},
  {id:'consent',type:'consent',label:'Agreement',description:'Read the terms',terms:'No <script> execution',required:true},
 ];
 const html=renderToStaticMarkup(React.createElement(RegistrationFields,{fields,answers:{choice:'One',consent:true},onChange:()=>{}}));
 assert.match(html,/Choose &lt;script&gt;/);assert.match(html,/No &lt;script&gt; execution/);assert.match(html,/<legend>/);assert.match(html,/aria-required="true"/);assert.match(html,/checked=""/);
});
test('saved open forms provide sharing controls, but drafts and expired forms do not',()=>{
 globalThis.location={origin:'https://refreshed.muhammadiwelfare.org.au'};
 try{
  const form={id:'a4b0d27e-f2fd-4f2c-941f-36638a7d61ed',title:'Community form',published:true,expiresAt:'9999-12-31T00:00:00.000Z'};
  const html=renderToStaticMarkup(React.createElement(RegistrationShare,{form}));
  assert.match(html,/Copy link/);assert.match(html,/WhatsApp/);assert.match(html,/Text message/);assert.match(html,/shared=1/);
  for(const closed of [{...form,published:false},{...form,expiresAt:'2020-01-01T00:00:00.000Z'}]){
   assert.doesNotMatch(renderToStaticMarkup(React.createElement(RegistrationShare,{form:closed})),/Copy link|href=/);
  }
 }finally{delete globalThis.location;}
});
test('shared form route omits website registration navigation without changing the normal route',()=>{
 try{
  globalThis.location={search:'?form=a4b0d27e-f2fd-4f2c-941f-36638a7d61ed&shared=1'};
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Registrations)),/All registrations|Back to Home/);
  globalThis.location.search='?form=a4b0d27e-f2fd-4f2c-941f-36638a7d61ed';
  assert.match(renderToStaticMarkup(React.createElement(Registrations)),/All registrations/);
 }finally{delete globalThis.location;}
});
