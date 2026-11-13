import test from 'node:test';
import assert from 'node:assert/strict';
import {adminReturnTarget} from './admin-entry-route.mjs';
test('post-login module and booking handoffs preserve only approved local targets',()=>{
 for(const target of ['/cms','/calendar-management/','/tools-automation/','/calendar/?view=admin','/enquiries/','/enquiries/?mailbox=setup','/calendar/?booking=synthetic&decision=approve'])assert.equal(adminReturnTarget(target),target);
 for(const target of [null,'https://evil.invalid/','//evil.invalid/','/calendar/?view=admin&redirect=evil','/admin-login?returnTo=/cms'])assert.equal(adminReturnTarget(target),null);
});

test('approved admin deep links preserve exact destinations without opening redirects',()=>{
 for(const target of ['/admin-login?module=donations','/admin-login?module=niaz&tab=sponsors','/tools-automation/?tab=team','/admin-login?module=niaz&tools=notifications'])assert.equal(adminReturnTarget(target),target);
 for(const target of ['/admin-login?module=donations&redirect=https://evil.invalid','/admin-login?module=unknown','/admin-login?module=niaz&tab=settings','/tools-automation/?tab=team&redirect=evil'])assert.equal(adminReturnTarget(target),null);
});
test('assistant catalogue no longer offers protected login continuations',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);const {available}=require('../functions/mwa-ai.js');
 const entries=available(['website-cms'],true);assert(entries.length>20);assert(entries.every(e=>e.public&&!e.href.includes('admin-login')&&e.access==='available'));
});
