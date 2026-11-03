import test from 'node:test';
import assert from 'node:assert/strict';
import {formShareLinks} from './registration-share.mjs';
test('share links open the specific standalone form and safely encode WhatsApp and text content',()=>{
 const form={id:'a4b0d27e-f2fd-4f2c-941f-36638a7d61ed',title:'Community & family #1'};
 const links=formShareLinks('https://refreshed.muhammadiwelfare.org.au',form);
 const direct=new URL(links.url),whatsapp=new URL(links.whatsapp);
 assert.equal(direct.pathname,'/registrations/');
 assert.equal(direct.searchParams.get('form'),form.id);assert.equal(direct.searchParams.get('shared'),'1');
 assert.equal(whatsapp.searchParams.get('text'),form.title+'\n'+links.url);
 assert.equal(decodeURIComponent(links.sms.slice('sms:?body='.length)),form.title+'\n'+links.url);
 assert.match(formShareLinks(direct.origin,form,true).sms,/^sms:&body=/);
});
