const {test}=require('node:test');const assert=require('node:assert/strict');
const {auditEntry,moduleFor,auditFilters,matchesAudit,changedValues}=require('./auditModel');
test('historic booking/admin logs and new modules share a normalized module and actor',()=>{
 assert.equal(moduleFor({entityType:'admin',action:'admin.added'}),'tools-automation');
 assert.equal(moduleFor({entityType:'event',action:'updated'}),'events-bookings');
 const entry=auditEntry({module:'calendar-management',entityType:'hijri',entityId:'1448-5',action:'hijri.override_saved',userId:'uid',userEmail:'ADMIN@MWA.AU'},'2026-10-27T00:00:00.000Z');
 assert.equal(entry.userEmail,'admin@mwa.au');assert.equal(entry.userId,'uid');assert.equal(entry.timestamp,'2026-10-27T00:00:00.000Z');
});
test('Sydney audit date ranges include the whole day and handle both daylight-saving transitions',()=>{
 assert.deepEqual(auditFilters({from:'2026-10-04',to:'2026-10-04'}),{from:'2026-10-03T14:00:00.000Z',to:'2026-10-04T13:00:00.000Z',user:'',module:''});
 const f=auditFilters({from:'2026-04-05',to:'2026-04-05'});assert.equal((Date.parse(f.to)-Date.parse(f.from))/3600000,25);
 assert.throws(()=>auditFilters({from:'2026-02-30'}));assert.throws(()=>auditFilters({from:'2026-10-28',to:'2026-10-27'}));
});
test('user and module filters combine and match historic entries',()=>{
 const f=auditFilters({user:'ADMIN@MWA',module:'tools-automation'});
 assert.equal(matchesAudit({userEmail:'admin@mwa.au',entityType:'admin'},f),true);
 assert.equal(matchesAudit({userEmail:'other@mwa.au',entityType:'admin'},f),false);
 assert.equal(matchesAudit({userEmail:'admin@mwa.au',entityType:'event'},f),false);
});
test('change details retain before/after values and deletions',()=>{
 assert.deepEqual(changedValues({name:'Before',active:true,updatedBy:'old'},{name:'After',updatedBy:'new'}),{name:{before:'Before',after:'After'},active:{before:true,after:null}});
});
test('Form Builder activity retains its own module and can be filtered independently',()=>{
 const entry=auditEntry({module:'form-builder',entityType:'registration-form',entityId:'form',action:'registration.published',userId:'forms-admin'});
 assert.equal(entry.module,'form-builder');
 assert.equal(matchesAudit(entry,auditFilters({module:'form-builder'})),true);
 assert.equal(matchesAudit(entry,auditFilters({module:'website-cms'})),false);
});
