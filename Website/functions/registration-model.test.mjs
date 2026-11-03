import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanFields,templateFields,FORM_TEMPLATES,makeField,validateAnswers,moveField} from './registration-model.mjs';
test('builder preserves Community Connect field types, validates choices and keeps consent last',()=>{
 const consent={...makeField('consent','agreement'),terms:'Please agree to these terms.'};
 const choice={...makeField('checkboxes','choices'),required:true};
 const fields=cleanFields([consent,...templateFields(FORM_TEMPLATES[0]),choice]);
 assert.equal(fields.at(-1).id,'agreement');
 for(const patch of [{options:['One','One']},{options:['']},{options:new Array(21).fill('One')}]){
  assert.throws(()=>cleanFields([{...choice,...patch}]));
 }
 for(const input of [[],new Array(31).fill(choice),[{...choice,id:'__proto__'}],[{...choice,id:123}],[choice,choice],[{...consent,required:false}],[{...consent,terms:''}]]){
  assert.throws(()=>cleanFields(input));
 }
 assert.deepEqual(moveField(fields,fields.length-2,1),fields);
 assert.equal(moveField(fields,0,1)[1].id,fields[0].id);
});
test('answers enforce required fields, actual value types, choice allowlists and consent',()=>{
 const fields=cleanFields([
  ...templateFields(FORM_TEMPLATES[0]),
  {...makeField('number','age'),required:true},
  {...makeField('date','date'),required:true},
  {...makeField('checkboxes','choices'),required:true},
  {...makeField('consent','agreement'),terms:'Terms'},
 ]);
 const answers={name:'Visitor',email:'visitor@example.com',phone:'0412345678',age:'0',date:'2027-02-28',choices:['Option 1'],agreement:true};
 assert.deepEqual(validateAnswers(fields,answers),{});
 for(const patch of [{email:'invalid'},{email:{}},{phone:'a'},{age:'Infinity'},{date:'2027-02-30'},{choices:['other']},{choices:['Option 1','Option 1']},{agreement:'true'},{name:' '},{name:'x'.repeat(2001)},{unknown:'answer'}]){
  assert.ok(Object.keys(validateAnswers(fields,{...answers,...patch})).length,JSON.stringify(patch));
 }
 assert.ok(validateAnswers(fields,[]).form);
});
