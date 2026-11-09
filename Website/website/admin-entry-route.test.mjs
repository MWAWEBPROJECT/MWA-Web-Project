import test from 'node:test';
import assert from 'node:assert/strict';
import {adminReturnTarget} from './admin-entry-route.mjs';
test('post-login module and booking handoffs preserve only approved local targets',()=>{
 for(const target of ['/cms','/calendar-management/','/tools-automation/','/calendar/?view=admin','/enquiries/','/enquiries/?mailbox=setup','/calendar/?booking=synthetic&decision=approve'])assert.equal(adminReturnTarget(target),target);
 for(const target of [null,'https://evil.invalid/','//evil.invalid/','/calendar/?view=admin&redirect=evil','/admin-login?returnTo=/cms'])assert.equal(adminReturnTarget(target),null);
});
