const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('./insights-multi-cleanup');

test('scheduled temporary cleanup is off by default and reports successful bounded progress',async()=>{
 let calls=0;const messages=[],logger={info:(...args)=>messages.push(args),error:()=>assert.fail('unexpected failure')};
 const cleanup=async()=>{calls++;return {jobs:2,deleted:100,pending:1};};
 assert.deepEqual(await run({}, {logger,cleanup}),{enabled:false});assert.equal(calls,0);
 assert.deepEqual(await run({}, {enabled:true,logger,cleanup}),{enabled:true,jobs:2,deleted:100,pending:1});
 assert.equal(calls,1);assert.deepEqual(messages[0][1],{jobs:2,deleted:100,pending:1});
});

test('scheduled temporary cleanup logs and rethrows failures for retry',async()=>{
 const error=Error('synthetic failure'),messages=[],logger={info:()=>assert.fail('unexpected success'),error:(...args)=>messages.push(args)};
 await assert.rejects(run({}, {enabled:true,logger,cleanup:async()=>{throw error;}}),error);
 assert.equal(messages[0][1],error);
});
