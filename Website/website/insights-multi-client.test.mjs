import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMultiSnapshot} from './insights-multi-client.mjs';

test('snapshot preparation sends bounded steps and reports progress',async()=>{
 const requests=[],progress=[];let started='';
 const api=async(_path,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  if(body.action==='multi-start')return {jobId:'job',status:'running',step:0};
  if(body.step===0)return {jobId:'job',status:'running',step:1,scanned:100};
  return {jobId:'job',status:'complete',step:2,scanned:120};
 };
 const jobId=await prepareMultiSnapshot({api,eventIds:['a','b'],programmeFilters:{bookingType:'community'},formId:'form',isCurrent:()=>true,onStart:id=>{started=id;},onProgress:value=>progress.push(value)});
 assert.equal(jobId,'job');assert.equal(started,'job');assert.deepEqual(progress,[100,120]);
 assert.deepEqual(requests.map(item=>item.action),['multi-start','multi-step','multi-step']);assert.equal(requests[0].bookingType,'community');
});

test('a start that completes after cancellation is cancelled without reading results',async()=>{
 const actions=[],api=async(_path,options)=>{const body=JSON.parse(options.body);actions.push(body.action);return body.action==='multi-start'?{jobId:'job',status:'running',step:0}:{ok:true};};
 const jobId=await prepareMultiSnapshot({api,eventIds:['a','b'],programmeFilters:{},formId:'',isCurrent:()=>false,onStart:()=>assert.fail('cancelled job started'),onProgress:()=>assert.fail('cancelled job progressed')});
 assert.equal(jobId,'');assert.deepEqual(actions,['multi-start','multi-cancel']);
});
