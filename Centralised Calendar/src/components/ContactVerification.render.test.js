import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('shared contact controls expose labels, validation gates, OTP and verified states',async()=>{
 const server=await createServer({configFile:false,root,server:{middlewareMode:true},appType:'custom'});
 try{
  const {default:Contact}=await server.ssrLoadModule('/src/components/ContactVerification.jsx');
  const props={idPrefix:'test',method:'email',contact:'',code:'',onMethodChange:()=>{},onContactChange:()=>{},onCodeChange:()=>{}};
  let html=renderToStaticMarkup(React.createElement(Contact,props));
  assert.match(html,/for="test-contact"/);assert.match(html,/type="email"/);assert.match(html,/disabled=""[^>]*>Send verification code/);assert.doesNotMatch(html,/role="alert"/);
  html=renderToStaticMarkup(React.createElement(Contact,{...props,contact:'person@example.org'}));assert.doesNotMatch(html,/disabled=""[^>]*>Send verification code/);
  html=renderToStaticMarkup(React.createElement(Contact,{...props,method:'mobile',contact:'0412345678',challenge:{maskedContact:'04••••5678'},code:'12'}));
  assert.match(html,/inputMode="numeric"/i);assert.match(html,/one-time-code/);assert.match(html,/disabled=""[^>]*>Verify contact/);assert.match(html,/booking-phone-recaptcha/);
  html=renderToStaticMarkup(React.createElement(Contact,{...props,contact:'person@example.org',verified:true}));assert.match(html,/Contact verified/);assert.doesNotMatch(html,/>Send verification code/);
 }finally{await server.close();}
});
