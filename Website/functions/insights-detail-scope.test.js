const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('./insights-detail-scope');
const formA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',formB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('form and saved event filters intersect; single dimension grants remain valid',()=>{
 const both=S.cleanScope({formIds:[formA],eventIds:['one']});
 assert.equal(S.matches(both,formA,'one'),true);
 assert.equal(S.matches(both,formA,'two'),false);
 assert.equal(S.matches(both,formB,'one'),false);
 assert.equal(S.matches(S.cleanScope({formIds:[formA],eventIds:[]}),formA,'two'),true);
 assert.equal(S.matches(S.cleanScope({formIds:[],eventIds:['one']}),formB,'one'),true);
 assert.throws(()=>S.cleanScope({formIds:[],eventIds:[]}),/at least one/);
 assert.throws(()=>S.cleanScope({formIds:[formA,formA],eventIds:[]}),/duplicates/);
});

test('grant requires the active bound admin, current revision and unexpired assignment',()=>{
 const actor={uid:'admin-1',email:'admin@example.invalid'},grant={uid:actor.uid,email:actor.email,revision:3,expiresAt:'2030-01-01T00:00:00.000Z',revoked:false},now=Date.parse('2026-01-01T00:00:00Z');
 assert.equal(S.activeGrant(grant,actor,3,now),true);
 assert.equal(S.activeGrant(grant,actor,2,now),false);
 assert.equal(S.activeGrant({...grant,revoked:true},actor,3,now),false);
 assert.equal(S.activeGrant(grant,{...actor,uid:'other'},3,now),false);
 assert.equal(S.activeGrant(grant,actor,3,Date.parse('2030-01-01T00:00:00Z')),false);
 assert.equal(S.activeGrant(null,{email:'admin@muhammadiwelfare.org.au'},null,now),true);
});

test('saved snapshot projection retains permitted answers and consent, omitting private backups',()=>{
 const source={reference:'EXAMPLE',formTitle:'Example',purpose:'Test',eventId:'private',createdAt:'2026-01-01T00:00:00.000Z',revision:2,fields:[{id:'email',type:'email',label:'Email',options:[],internal:'hidden'},{id:'agree',type:'consent',label:'Consent',terms:'Terms',options:[]}],answers:{email:'example@example.invalid',agree:true},digest:'secret',originalAnswers:{email:'old@example.invalid'},editRevision:1,editedAt:'2026-01-02T00:00:00Z',editedBy:'private'};
 const result=S.projectResponse(formA,'response',source);
 assert.equal(result.answers.agree,true);
 assert.equal(result.fields[1].terms,'Terms');
 assert.equal(result.eventId,'');
 assert.equal(result.editRevision,1);
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.equal(JSON.stringify(result).includes('old@example.invalid'),false);
 assert.equal(JSON.stringify(result).includes('internal'),false);
 assert.throws(()=>S.projectResponse(formA,'response',{...source,answers:{unknown:'answer'}}),/without a saved question/);
 assert.throws(()=>S.projectResponse(formA,'response',{...source,answers:{email:{backup:'private'}}}),/invalid saved answer/);
});
