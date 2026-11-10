import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactInput,contactError,verificationPhone} from './contactVerification.mjs';
test('mobile input contains digits only and accepts Australian and international forms',()=>{
 assert.equal(contactInput('mobile','+61 (412) abc-345 678'),'61412345678');
 assert.equal(contactInput('mobile','123456789012345678'), '123456789012345');
 for(const [input,expected] of [['0412345678','+61412345678'],['61412345678','+61412345678'],['+61412345678','+61412345678'],['447123456789','+447123456789']]){
  assert.equal(verificationPhone(input),expected);assert.equal(contactError('mobile',input),'');
 }
 for(const input of ['', '0412','letters','0000000000','1234567890123456'])assert.notEqual(contactError('mobile',input),'');
});
test('email syntax is validated without rejecting valid subdomains or plus addressing',()=>{
 for(const input of ['person@example.org','person+niaz@mail.example.org',' person@example.org '])assert.equal(contactError('email',input),'');
 for(const input of ['', 'person', 'person@', '@example.org', 'person@example', 'person@.org','person @example.org','person@example..org'])assert.notEqual(contactError('email',input),'');
 assert.equal(contactInput('email','person+niaz@example.org'),'person+niaz@example.org');
});
